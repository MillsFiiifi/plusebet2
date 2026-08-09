// Automatic bet settlement.
//
// When a match finishes, evaluate every pending bet that has a leg on it:
//   • any leg that definitively LOST → the whole bet loses (stake already gone)
//   • all legs WON → the bet wins and the payout is credited to the wallet
//   • otherwise (a leg's match hasn't finished, or its market can't be auto-
//     judged) → leave the bet pending for the admin / a later run
//
// Only the 1X2 (match-result) market is auto-judged, off the final score —
// which is exactly what custom scripted matches use. Other markets and real
// API-Football results are left for manual settlement.

import {
  readBets,
  readBetsForUser,
  settleBetIfPending,
  setSelectionStatusById,
  revertBetToPending,
} from '@/lib/bets-store'
import { creditBalance } from '@/lib/users-store'
import { readCustomMatches } from '@/lib/custom-matches-store'
import { liveClockLabel } from '@/lib/match-betting'
import type { BetSelection, Match, PlacedBet } from '@/lib/domain-types'

interface FinalScore {
  home: number
  away: number
}

/** Final score for a custom match, or null if it isn't finished yet. */
function finalResult(m: Match): FinalScore | null {
  if (m.homeScore == null || m.awayScore == null) return null
  const ft = m.minute === 'FT' || liveClockLabel(m.startTimeISO, m.sport).label === 'FT'
  if (!ft) return null
  return { home: m.homeScore, away: m.awayScore }
}

type LegResult = 'won' | 'lost' | 'pending'

/** Judge a single 1X2 leg against a final score; 'pending' if not judgeable. */
function judgeLeg(leg: BetSelection, finished: Map<string, FinalScore>): LegResult {
  const score = finished.get(leg.matchId)
  if (!score) return 'pending'

  const actual: 'home' | 'draw' | 'away' =
    score.home > score.away ? 'home' : score.home < score.away ? 'away' : 'draw'

  // The slip stores the pick as the team name (or "Draw"); `selection` may also
  // be set. Map it to home/draw/away.
  const outcome = (leg.outcomeKey || leg.outcomeLabel || '').trim()
  let pick: 'home' | 'draw' | 'away' | null = leg.selection ?? null
  if (!pick) {
    if (outcome === leg.match.homeTeam) pick = 'home'
    else if (outcome === leg.match.awayTeam) pick = 'away'
    else if (/^draw$/i.test(outcome) || outcome.toLowerCase() === 'x') pick = 'draw'
  }
  if (!pick) return 'pending' // unknown market (over/under, btts, …) — leave it
  return pick === actual ? 'won' : 'lost'
}

export interface SettleResult {
  checked: number
  won: number
  lost: number
  creditedTotal: number
}

/**
 * Settle finished bets. Pass a userId to settle just that player's bets
 * (responsive, called when they open My Bets); omit it to settle everyone
 * (the cron). Idempotent — settleBetIfPending guards against double-credit.
 */
export async function settlePendingBets(userId?: string): Promise<SettleResult> {
  const result: SettleResult = { checked: 0, won: 0, lost: 0, creditedTotal: 0 }

  // Build the finished-match → final-score map from custom (scripted) matches.
  const customMatches = await readCustomMatches()
  const finished = new Map<string, FinalScore>()
  for (const m of customMatches) {
    const r = finalResult(m)
    if (r) finished.set(m.id, r)
  }
  if (finished.size === 0) return result // nothing has finished — nothing to do

  const bets: PlacedBet[] = userId ? await readBetsForUser(userId) : await readBets()

  for (const bet of bets) {
    if (bet.status !== 'pending') continue
    result.checked++

    const legResults = bet.selections.map((leg) => ({ leg, res: judgeLeg(leg, finished) }))
    const anyLost = legResults.some((l) => l.res === 'lost')
    const allWon = legResults.every((l) => l.res === 'won')

    if (!anyLost && !allWon) continue // still has undecided legs

    const settledAt = new Date().toISOString()
    if (allWon) {
      const payout = bet.payout ?? bet.potentialWin
      const settled = await settleBetIfPending(bet.id, { status: 'won', settledAt, payout })
      if (!settled) continue // another path already settled it

      // Credit the wallet BEFORE we consider the win final. If the credit
      // fails, revert the bet to pending so the next run retries the whole
      // thing — never leave a bet 'won' but unpaid (that was the old bug: the
      // credit error was swallowed and the win could never be re-credited).
      try {
        if (bet.userId) {
          const credited = await creditBalance(bet.userId, payout)
          if (!credited) throw new Error(`creditBalance returned null for user ${bet.userId}`)
        }
      } catch (e) {
        console.error('[settle] credit failed — reverting bet to pending:', bet.id, e)
        await revertBetToPending(bet.id).catch(() => {})
        continue
      }

      for (const l of legResults) await setSelectionStatusById(l.leg.id, 'won').catch(() => {})
      result.won++
      result.creditedTotal += payout
    } else {
      const settled = await settleBetIfPending(bet.id, { status: 'lost', settledAt, payout: 0 })
      if (!settled) continue
      // Colour each judged leg; undecided legs stay pending (they're moot now).
      for (const l of legResults) {
        if (l.res !== 'pending') await setSelectionStatusById(l.leg.id, l.res).catch(() => {})
      }
      result.lost++
    }
  }

  return result
}
