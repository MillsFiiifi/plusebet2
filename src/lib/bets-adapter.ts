// Maps the backend PlacedBet model (`@/lib/domain-types`, returned by
// /api/bets) into the UI Bet shape that BetCard / my-bets / bet-history
// render (`@/lib/types`). Pure mapping — no fetching.

import type { PlacedBet, BetSelection } from '@/lib/domain-types'
import type { Bet } from '@/lib/types'

function matchLabel(s: BetSelection): string {
  const m = s.match
  if (m && (m.homeTeam || m.awayTeam)) {
    return `${m.homeTeam ?? ''} v ${m.awayTeam ?? ''}`.trim()
  }
  return s.marketLabel ?? 'Match'
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 17-char alphanumeric verification code, deterministic per bet — mirrors the
 * reference ticket: bet UUID hex + public code, padded, sliced to 17.
 */
function verifyCodeFor(id: string, code: string): string {
  const idHex = id.replace(/-/g, '').toUpperCase()
  return `${idHex}${code}0000000000`.slice(0, 17)
}

export function placedBetToUi(b: PlacedBet): Bet {
  const legs = (b.selections ?? []).map((s) => ({
    matchId: s.matchId ?? '',
    match: matchLabel(s),
    pick: s.outcomeLabel ?? s.marketLabel ?? '—',
    odds: Number(s.odds) || 0,
    result: (s.status ?? 'pending') as 'won' | 'lost' | 'pending',
  }))

  return {
    id: b.code ?? b.id,
    type: legs.length > 1 ? 'multi' : 'single',
    legs,
    stake: b.stake,
    totalOdds: b.totalOdds,
    potential: b.payout ?? b.potentialWin,
    // PlacedBet status is 'pending' | 'won' | 'lost'; the UI also models
    // 'cashout' but the API never emits it, so this maps 1:1.
    status: b.status,
    date: fmtDate(b.placedAt),
    currency: b.currency,
    verifyCode: verifyCodeFor(b.id, b.code ?? b.id),
  }
}
