// Backend / server domain model (ported from the PrimeBet reference).
// Kept separate from the UI-facing types in `@/lib/types` so the existing
// nextwin frontend (which has its own Match/Sport shapes) is untouched.
// The ported lib stores, API routes, and admin pages all import from here.

import type { CountryCode, CurrencyCode } from '@/lib/countries'

/** A scripted goal on a custom match: which side scores, at what match minute. */
export interface MatchGoal {
  minute: number
  team: 'home' | 'away'
}

export interface Match {
  id: string
  league: string
  country: string
  homeTeam: string
  awayTeam: string
  homeScore?: number
  awayScore?: number
  minute?: string
  startTime?: string
  startTimeISO?: string
  isLive: boolean
  odds: {
    home: number
    draw: number
    away: number
  }
  markets?: MarketBook
  sport?: string
  custom?: boolean
  demo?: boolean
  /** Public image URLs for team flags / crests, set by admin on custom matches. */
  homeFlagUrl?: string
  awayFlagUrl?: string
  /** Country/league flag image URL from the upstream feed (API-Football). */
  countryFlagUrl?: string
  /** Admin manual lock — when true, no new bets are accepted regardless of isLive / startTime. */
  locked?: boolean
  /** Admin marked the match postponed — players see a "Postponed" badge and
   *  new bets are locked. Existing bets are left untouched. */
  postponed?: boolean
  /** Scripted goal timeline (custom matches): drives the live score off the clock. */
  goals?: MatchGoal[]
}

export interface OverUnderLine {
  line: number
  over: number
  under: number
}

export interface ScoreOdds {
  score: string
  odds: number
}

export interface HtFtOdds {
  code: string
  label: string
  odds: number
}

export interface MarketBook {
  matchWinner: { home: number; draw: number; away: number }
  doubleChance: { homeOrDraw: number; homeOrAway: number; drawOrAway: number }
  overUnder: OverUnderLine[]
  btts: { yes: number; no: number }
  correctScore: ScoreOdds[]
  halfTimeFullTime: HtFtOdds[]
  firstHalf1X2?: { home: number; draw: number; away: number }
  drawNoBet?: { home: number; away: number }
}

export interface BetSelection {
  id: string
  matchId: string
  match: Match
  marketKey: string
  marketLabel: string
  outcomeKey: string
  outcomeLabel: string
  odds: number
  selection?: 'home' | 'draw' | 'away'
  /** Per-leg result: 'pending' until the bet settles, then 'won' / 'lost'. */
  status?: 'pending' | 'won' | 'lost'
}

export interface League {
  id: string
  name: string
  country: string
  flag: string
  matchCount: number
}

export interface Sport {
  id: string
  name: string
  icon: string
  matchCount: number
}

export interface AppUser {
  id: string
  name: string
  email: string
  passwordHash: string
  phone?: string
  /** ISO country code (see CountryCode in @/lib/countries). */
  country: CountryCode
  /** Wallet currency (see CurrencyCode). Mirrors country. */
  currency: CurrencyCode
  /** Ghana Card number (legacy column; only populated for GH users). */
  ghanaCard?: string
  /** Country-specific KYC value: Ghana Card, BVN/NIN, Kenyan/SA national ID. */
  kycId?: string
  referredByCode?: string
  referredBySubAdminId?: string
  firstDepositAmount: number
  firstDepositAt?: string
  totalDeposited: number
  totalWithdrawn?: number
  balance?: number
  verificationStep?: 0 | 1 | 2 | 3 | 4
  withdrawalApproved?: boolean
  createdAt: string
}

export interface Commission {
  id: string
  subAdminId: string
  userId: string
  depositAmount: number
  commission: number
  rate: number
  currency: CurrencyCode
  createdAt: string
}

export const COMMISSION_RATE = 0.6 // 60% of every deposit from a referred user

export interface SubAdmin {
  id: string
  name: string
  email: string
  passwordHash: string
  referralCode: string
  approved: boolean
  createdAt: string
  /** Legacy GHS-only scalar (kept for back-compat reads). */
  commissionBalance: number
  /** Legacy GHS-only scalar (kept for back-compat reads). */
  totalCommissionEarned: number
  /** Per-currency balances — authoritative. */
  commissionBalances: Partial<Record<CurrencyCode, number>>
  /** Per-currency lifetime totals. */
  totalCommissionEarnedBy: Partial<Record<CurrencyCode, number>>
}

export interface PlacedBet {
  id: string
  code: string
  userId?: string | null
  placedAt: string
  stake: number
  totalOdds: number
  potentialWin: number
  currency: CurrencyCode
  status: 'pending' | 'won' | 'lost'
  selections: BetSelection[]
  settledAt?: string
  payout?: number
}
