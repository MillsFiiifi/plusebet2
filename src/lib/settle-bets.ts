// Automatic bet settlement.
//
// When a match finishes, evaluate every pending bet that has a leg on it:
//   • any leg that definitively LOST → the whole bet loses (stake already gone)
//   • all legs WON → the bet wins and the payout is credited to the wallet
//   • otherwise (a leg's match hasn't finished, or its market can't be auto-
//     judged) → leave the bet pending for the admin / a later run
//
// Finished scores come from TWO sources, so games settle on their own with no
// admin marking:
//   • custom (scripted) matches — final score off their own clock/score
//   • REAL API-Football fixtures — final score fetched from the results feed
//
// Markets auto-judged off the final score: 1X2 / Match Result, Double Chance,
// Over/Under (Total Goals), Both Teams To Score, Correct Score, and Draw No Bet
// (when not a draw). Anything the data can't decide stays pending — nothing is
// ever guessed, because a wrong settlement moves real money.

import {
  readBets,
  readBetsForUser,
  settleBetIfPending,
  setSelectionStatusById,
  revertBetToPending,
} from '@/lib/bets-store'
import { creditBalance } from '@/lib/users-store'
import { readCustomMatches } from '@/lib/custom-matches-store'
import { fetchRealResults } from '@/lib/results'
import { liveClockLabel } from '@/lib/match-betting'
import type { BetSelection, Match, PlacedBet } from '@/lib/domain-types'

interface FinalScore {
  home: number
  away: number
  htHome?: number | null
  htAway?: number | null
}

/** Final score for a custom match, or null if it isn't finished yet. */
function finalResult(m: Match): FinalScore | null {
  if (m.homeScore == null || m.awayScore == null) return null
  const ft = m.minute === 'FT' || liveClockLabel(m.startTimeISO, m.sport).label === 'FT'
  if (!ft) return null
  return { home: m.homeScore, away: m.awayScore }
}

type LegResult = 'won' | 'lost' | 'pending'

/**
 * Judge one leg against a final score. Returns 'pending' for anything it can't
 * decide (unknown market, no result yet, a market needing data we don't have) —
 * conservative on purpose so we never settle wrongly.
 */
function judgeLeg(leg: BetSelection, finished: Map<string, FinalScore>): LegResult {
  const score = finished.get(leg.matchId)
  if (!score) return 'pending'

  const home = score.home
  const away = score.away
  const total = home + away
  const winner: 'home' | 'draw' | 'away' =
    home > away ? 'home' : home < away ? 'away' : 'draw'
  const bothScored = home > 0 && away > 0

  const market = (leg.marketLabel || leg.marketKey || '').toLowerCase().trim()
  const outcome = (leg.outcomeLabel || leg.outcomeKey || '').trim()
  const o = outcome.toLowerCase()
  const homeTeam = (leg.match.homeTeam || '').trim()
  const awayTeam = (leg.match.awayTeam || '').trim()

  // ── Over / Under (Total Goals) ── labels "Over 2.5" / "Under 2.5"
  const ou = outcome.match(/(over|under)\s+(\d+(?:\.\d+)?)/i)
  if (market.includes('over') || market.includes('total goals') || ou) {
    if (!ou) return 'pending'
    const line = parseFloat(ou[2])
    if (!Number.isFinite(line)) return 'pending'
    // .5 lines can't push; whole lines that land exactly are a void — leave those.
    if (Number.isInteger(line) && total === line) return 'pending'
    return ou[1].toLowerCase() === 'over'
      ? total > line ? 'won' : 'lost'
      : total < line ? 'won' : 'lost'
  }

  // ── Both Teams To Score ── labels "Yes" / "No"
  if (market.includes('both teams')) {
    if (/^yes$/i.test(outcome)) return bothScored ? 'won' : 'lost'
    if (/^no$/i.test(outcome)) return bothScored ? 'lost' : 'won'
    return 'pending'
  }

  // ── Double Chance ── labels "{home} or Draw" / "Home or Away" / "{away} or Draw"
  if (market.includes('double chance')) {
    const homeOrDraw = homeTeam && o.includes(homeTeam.toLowerCase()) && o.includes('draw')
    const awayOrDraw = awayTeam && o.includes(awayTeam.toLowerCase()) && o.includes('draw')
    const homeOrAway = o === 'home or away'
    if (homeOrDraw) return winner === 'home' || winner === 'draw' ? 'won' : 'lost'
    if (awayOrDraw) return winner === 'away' || winner === 'draw' ? 'won' : 'lost'
    if (homeOrAway) return winner === 'home' || winner === 'away' ? 'won' : 'lost'
    return 'pending'
  }

  // ── Correct Score ── labels like "2-1"
  if (market.includes('correct score')) {
    const cs = outcome.match(/(\d+)\s*[-:]\s*(\d+)/)
    if (!cs) return 'pending'
    return Number(cs[1]) === home && Number(cs[2]) === away ? 'won' : 'lost'
  }

  // ── Draw No Bet ── labels are the team names; a draw voids (leave pending)
  if (market.includes('draw no bet')) {
    if (winner === 'draw') return 'pending' // stake refund is an admin/void call
    if (homeTeam && outcome === homeTeam) return winner === 'home' ? 'won' : 'lost'
    if (awayTeam && outcome === awayTeam) return winner === 'away' ? 'won' : 'lost'
    return 'pending'
  }

  // ── Match Result (1X2) ── labels are the team names or "Draw" (also the
  // default for legacy legs that carry `selection`).
  const looks1x2 =
    market.includes('1x2') ||
    market.includes('match result') ||
    leg.selection != null ||
    outcome === homeTeam ||
    outcome === awayTeam ||
    /^draw$/i.test(outcome) ||
    o === 'x'
  if (looks1x2) {
    let pick: 'home' | 'draw' | 'away' | null = leg.selection ?? null
    if (!pick) {
      if (homeTeam && outcome === homeTeam) pick = 'home'
      else if (awayTeam && outcome === awayTeam) pick = 'away'
      else if (/^draw$/i.test(outcome) || o === 'x') pick = 'draw'
    }
    if (!pick) return 'pending'
    return pick === winner ? 'won' : 'lost'
  }

  // Half Time / Full Time, First Half, and anything else — left for the admin.
  return 'pending'
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

  const bets: PlacedBet[] = userId ? await readBetsForUser(userId) : await readBets()
  const pending = bets.filter((b) => b.status === 'pending')
  if (pending.length === 0) return result

  // Finished-score map from custom (scripted) matches.
  const customMatches = await readCustomMatches()
  const customIds = new Set(customMatches.map((m) => m.id))
  const finished = new Map<string, FinalScore>()
  for (const m of customMatches) {
    const r = finalResult(m)
    if (r) finished.set(m.id, r)
  }

  // Plus REAL API-Football fixtures: every distinct non-custom match id riding
  // on a pending leg. This is what makes real games settle on their own.
  const realIds = new Set<string>()
  for (const bet of pending) {
    for (const leg of bet.selections) {
      if (leg.matchId && !customIds.has(leg.matchId)) realIds.add(leg.matchId)
    }
  }
  if (realIds.size > 0) {
    try {
      const real = await fetchRealResults([...realIds])
      for (const [id, r] of real) {
        finished.set(id, { home: r.home, away: r.away, htHome: r.htHome, htAway: r.htAway })
      }
    } catch (e) {
      console.error('[settle] fetchRealResults failed (custom still settle):', e)
    }
  }

  if (finished.size === 0) return result // nothing finished yet

  for (const bet of pending) {
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

      // Credit the wallet BEFORE we consider the win final. If the credit fails,
      // revert to pending so a later run retries — never leave a bet won-unpaid.
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
