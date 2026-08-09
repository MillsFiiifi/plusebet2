"use client";

import Link from "next/link";
import { Ticket } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BetCard } from "@/components/bet-card";
import { useBets } from "@/lib/use-bets";
import { useMatches } from "@/lib/use-matches";

export default function MyBetsPage() {
  const { bets, loading, loggedIn } = useBets();
  // Games in-play right now — a pending bet on one of these shows "Playing".
  const { live } = useMatches();
  const liveMatchIds = new Set(live.map((m) => m.id));
  const open = bets.filter((b) => b.status === "pending" || b.status === "cashout");
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");

  return (
    <AppShell tabs={false}>
      <div className="flex items-center gap-2.5 mb-5">
        <span className="title-bar" />
        <h1 className="font-display font-extrabold text-[18px]">My Bets</h1>
        <span className="num text-[10px] font-bold grad-violet-pink text-white px-2 py-1 rounded-md">{open.length} OPEN</span>
      </div>

      {!loggedIn ? (
        <EmptyState
          title="Sign in to see your bets"
          body="Your placed tickets are tied to your account."
          cta={{ href: "/login", label: "Log in" }}
        />
      ) : loading ? (
        <p className="text-[13px] text-[var(--color-ink-faint)] py-10 text-center">Loading your bets…</p>
      ) : (
        <>
          {open.length > 0 ? (
            <div className="space-y-3">
              {open.map((b) => (
                <BetCard key={b.id} b={b} liveMatchIds={liveMatchIds} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No open bets"
              body="Place a bet to see it tracked live here."
              cta={{ href: "/", label: "Browse Sports" }}
            />
          )}

          {settled.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 mt-7">
                <div className="flex items-center gap-2.5">
                  <span className="title-bar" />
                  <h2 className="font-display font-extrabold text-[15px]">Recently Settled</h2>
                </div>
                <Link href="/bet-history" className="text-[11.5px] font-semibold text-[var(--color-cyan)] hover:underline">Full history →</Link>
              </div>
              <div className="space-y-3">
                {settled.map((b) => (
                  <BetCard key={b.id} b={b} liveMatchIds={liveMatchIds} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta: { href: string; label: string } }) {
  return (
    <div className="card flex flex-col items-center text-center py-14 px-6">
      <div className="grid place-items-center w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-line)] mb-4">
        <Ticket className="text-[var(--color-ink-faint)]" size={24} />
      </div>
      <h3 className="font-display font-bold text-[15px]">{title}</h3>
      <p className="text-[12.5px] text-[var(--color-ink-faint)] mt-1.5">{body}</p>
      <Link href={cta.href} className="mt-5 rounded-xl px-5 py-2.5 font-display font-bold grad-violet-pink text-white text-[13px]">{cta.label}</Link>
    </div>
  );
}
