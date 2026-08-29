// Real match results for automatic settlement (API-Football).
//
// Conservative by design: a result is returned ONLY when the fixture genuinely
// finished (FT/AET/PEN) and the scores are present. Anything missing comes back
// absent, and the judge leaves those legs pending rather than guessing — a
// wrong settlement moves real money.
//
// This is the piece that lets bets on REAL fixtures settle on their own, the
// same way custom scripted matches already do.

const BASE = 'https://v3.football.api-sports.io'
const TTL_MS = 5 * 60_000

export interface RealResult {
  home: number
  away: number
  htHome: number | null
  htAway: number | null
}

const cache = new Map<string, { at: number; value: RealResult }>()

/** Statuses that mean the match played to a normal conclusion. */
const SETTLED = new Set(['FT', 'AET', 'PEN'])

interface RawFixture {
  fixture: { id: number; status: { short: string } }
  goals: { home: number | null; away: number | null }
  score: {
    halftime: { home: number | null; away: number | null }
    fulltime: { home: number | null; away: number | null }
  }
}

/**
 * Final results for a batch of API-Football fixture ids. API-Football accepts
 * up to 20 ids per request joined with dashes. Cached 5 min; unfinished or
 * void fixtures are simply omitted (they aren't settleable).
 */
export async function fetchRealResults(ids: string[]): Promise<Map<string, RealResult>> {
  const out = new Map<string, RealResult>()
  const key = process.env.API_FOOTBALL_KEY?.trim()
  if (!key) return out

  const wanted: string[] = []
  for (const id of ids) {
    const hit = cache.get(id)
    if (hit && Date.now() - hit.at < TTL_MS) out.set(id, hit.value)
    else wanted.push(id)
  }
  if (!wanted.length) return out

  for (let i = 0; i < wanted.length; i += 20) {
    const batch = wanted.slice(i, i + 20)
    let raw: RawFixture[] | null = null
    try {
      const res = await fetch(`${BASE}/fixtures?ids=${batch.join('-')}`, {
        headers: { 'x-apisports-key': key },
        cache: 'no-store',
      })
      if (!res.ok) {
        console.error('[results] fixtures', res.status)
        continue
      }
      const json = (await res.json()) as { response?: RawFixture[] }
      raw = json.response ?? null
    } catch (e) {
      console.error('[results] fetch threw', e)
      continue
    }
    if (!raw) continue

    for (const f of raw) {
      const id = String(f.fixture.id)
      if (!SETTLED.has(f.fixture.status.short)) continue // not a normal finish

      const home = f.score?.fulltime?.home ?? f.goals?.home
      const away = f.score?.fulltime?.away ?? f.goals?.away
      if (home == null || away == null) continue

      const value: RealResult = {
        home: Number(home),
        away: Number(away),
        htHome: f.score?.halftime?.home ?? null,
        htAway: f.score?.halftime?.away ?? null,
      }
      cache.set(id, { at: Date.now(), value })
      out.set(id, value)
    }
  }

  return out
}
