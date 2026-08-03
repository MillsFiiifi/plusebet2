"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, Zap } from "lucide-react";
import { useMatches } from "@/lib/use-matches";
import { TeamBadge, CountryFlag } from "./brand";
import type { Match } from "@/lib/types";

// Promotional popup advertising a REAL match off the live feed (API-Football
// upstream + admin custom matches), so the teams, kickoff and odds are always
// current and the CTA opens a game the player can actually bet on. The featured
// match rotates every 2 minutes. Shows once per session on the home page; tap
// anywhere / X / CTA to dismiss.

const ROTATE_MS = 2 * 60 * 1000; // change the featured match every 2 minutes
const MAX_CANDIDATES = 9; // how deep into the feed we rotate

/** "Live · 63'" for in-play, otherwise "Today · 20:00" / "Tomorrow · 20:00". */
function whenLabel(m: Match): string {
  if (m.live) return m.halfTime ? "Live · HT" : `Live · ${m.minute ?? 0}'`;
  if (!m.startTimeISO) return m.kickoff;
  const t = new Date(m.startTimeISO);
  if (Number.isNaN(t.getTime())) return m.kickoff;
  const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.round(
    (new Date(t).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  return `${t.toLocaleDateString([], { weekday: "long" })} · ${time}`;
}

export function MatchAdvert() {
  const { live, today, tomorrow } = useMatches("football");
  const [open, setOpen] = useState(false);
  // Time-based seed so different visits land on different games; `tick` then
  // walks forward from it on each rotation.
  const [seed] = useState(() => Math.floor(Date.now() / ROTATE_MS));
  const [tick, setTick] = useState(0);

  // Live games lead — they're the strongest hook — then today, then tomorrow.
  // Locked/postponed games are dropped: the CTA must land on a bettable match.
  const candidates = useMemo(
    () =>
      [...live, ...today, ...tomorrow]
        .filter((m) => !m.locked && m.markets.length >= 3)
        .slice(0, MAX_CANDIDATES),
    [live, today, tomorrow],
  );

  // Open only once the feed has something to show — the popup is worthless
  // while the fixtures are still loading.
  useEffect(() => {
    if (open || candidates.length === 0) return;
    try {
      if (!sessionStorage.getItem("ad-wc-seen")) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [candidates.length, open]);

  // While the popup is open, advance to the next match every 2 minutes.
  useEffect(() => {
    if (!open || candidates.length === 0) return;
    const t = setInterval(() => {
      setTick((i) => i + 1);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [open, candidates.length]);

  function close() {
    setOpen(false);
    try {
      sessionStorage.setItem("ad-wc-seen", "1");
    } catch {
      /* ignore */
    }
  }

  if (!open || candidates.length === 0) return null;

  // The feed refreshes every 30s and can shrink as games finish, so clamp.
  const advert = candidates[(seed + tick) % candidates.length];

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-[80] grid place-items-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-[440px] overflow-hidden rounded-3xl border border-[var(--color-violet)]/30 shadow-[0_0_60px_-10px_rgba(139,92,246,.4)] animate-rise">
        {/* Pitch backdrop */}
        <div className="absolute inset-0 bg-[var(--color-bg-2)]" />
        <div className="absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(circle_at_50%_120%,rgba(16,185,129,.5),rgba(16,185,129,.1)_55%,transparent_75%)]" />
        <div className="absolute left-1/2 top-[34%] -translate-x-1/2 w-24 h-24 rounded-full border border-white/15" />

        {/* Top bar */}
        <div className="relative flex items-center justify-between px-4 pt-4">
          <span className="flex items-center gap-1.5 rounded-lg border border-[var(--color-amber)]/40 bg-black/40 px-2.5 py-1">
            <span className="font-display font-extrabold text-[13px] tracking-tight">
              PLUSE<span className="grad-text">BET</span>
            </span>
          </span>
          <button
            onClick={close}
            aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-full bg-black/50 border border-white/10 text-white/80 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="relative px-6 pt-5 pb-6 text-center">
          {advert.live ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rose)]/40 bg-[var(--color-rose)]/10 px-3.5 py-1.5 text-[11px] font-bold tracking-[0.14em] text-[var(--color-rose)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-rose)] animate-pulse" />
              LIVE NOW
              {typeof advert.scoreHome === "number" && typeof advert.scoreAway === "number" && (
                <span className="num">
                  {advert.scoreHome}–{advert.scoreAway}
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/10 px-3.5 py-1.5 text-[11px] font-bold tracking-[0.14em] text-[var(--color-amber)]">
              <CountryFlag url={advert.leagueFlagUrl} emoji={advert.leagueFlag} />
              <span className="truncate max-w-[220px]">{advert.league.toUpperCase()}</span>
            </span>
          )}

          {/* Teams */}
          <div className="mt-6 flex items-center justify-center gap-4">
            <Team name={advert.home} short={advert.homeShort} color={advert.homeColor} logo={advert.homeLogo} />
            <div className="flex flex-col items-center">
              <span className="font-display font-extrabold text-[22px] grad-text">VS</span>
            </div>
            <Team name={advert.away} short={advert.awayShort} color={advert.awayColor} logo={advert.awayLogo} />
          </div>

          <p className="text-[12.5px] text-[var(--color-ink-dim)] mt-4">
            {advert.league} · <span className="text-white font-semibold">{whenLabel(advert)}</span>
          </p>

          {/* Odds — straight off the feed, so they match the match page */}
          <div className="grid grid-cols-3 gap-2.5 mt-5">
            {advert.markets.slice(0, 3).map((mk) => (
              <Odd key={mk.label} label={mk.label} value={mk.odds.toFixed(2)} />
            ))}
          </div>

          {/* CTA */}
          <Link
            href={`/match/${advert.id}`}
            onClick={close}
            className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl py-4 font-display font-extrabold text-[15px] text-black grad-gold shadow-[0_12px_40px_-8px_rgba(250,204,21,.6)] active:scale-[.99] transition"
          >
            Bet on {advert.homeShort} vs {advert.awayShort} <Zap size={17} className="fill-black" />
          </Link>

          <p className="text-[11px] text-[var(--color-ink-faint)] mt-3">
            18+ only · Tap anywhere to close · Play responsibly
          </p>
        </div>
      </div>
    </div>
  );
}

function Team({
  name,
  short,
  color,
  logo,
}: {
  name: string;
  short: string;
  color: string;
  logo?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 w-[34%]">
      <TeamBadge short={short} color={color} size={64} logo={logo} />
      <span className="font-display font-extrabold text-[15px] leading-tight">{name}</span>
    </div>
  );
}

function Odd({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/70 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</div>
      <div className="num text-[18px] font-extrabold text-[var(--color-cyan)] mt-0.5">{value}</div>
    </div>
  );
}
