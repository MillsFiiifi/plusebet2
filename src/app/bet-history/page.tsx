"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BetCard } from "@/components/bet-card";
import { useBets } from "@/lib/use-bets";
import { useMatches } from "@/lib/use-matches";
import { cedis } from "@/lib/utils";

const TABS = ["All", "Won", "Lost", "Pending"];
const MAP: Record<string, string> = { Won: "won", Lost: "lost", Pending: "pending" };

export default function BetHistoryPage() {
  const [tab, setTab] = useState("All");
  const { bets, loading, loggedIn } = useBets();
  // In-play games — a pending bet on one of these shows "Playing".
  const { live } = useMatches();
  const liveMatchIds = new Set(live.map((m) => m.id));
  const list = tab === "All" ? bets : bets.filter((b) => b.status === MAP[tab]);
  const won = bets.filter((b) => b.status === "won").length;

  return (
    <AppShell tabs={false}>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="title-bar" />
        <h1 className="font-display font-extrabold text-[18px]">Bet History</h1>
      </div>

      {!loggedIn ? (
        <div className="card py-12 text-center">
          <p className="text-[13px] text-[var(--color-ink-dim)]">Sign in to view your bet history.</p>
          <Link href="/login" className="inline-block mt-4 rounded-xl px-5 py-2.5 font-display font-bold grad-violet-pink text-white text-[13px]">Log in</Link>
        </div>
      ) : loading ? (
        <p className="text-[13px] text-[var(--color-ink-faint)] py-10 text-center">Loading your history…</p>
      ) : bets.length === 0 ? (
        <div className="card py-12 text-center text-[13px] text-[var(--color-ink-faint)]">
          You haven&apos;t placed any bets yet.
        </div>
      ) : (
        <>
          {/* summary */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Summary label="Total Staked" value={cedis(bets.reduce((a, b) => a + b.stake, 0))} />
            <Summary label="Settled Won" value={`${won}/${bets.length}`} tone="emerald" />
            <Summary label="Returns" value={cedis(bets.filter((b) => b.status === "won").reduce((a, b) => a + b.potential, 0))} tone="amber" />
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
            {TABS.map((t) => (
              <button key={t} data-active={tab === t} onClick={() => setTab(t)} className="chip shrink-0 px-4 py-1.5">
                {t}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {list.map((b) => (
              <BetCard key={b.id} b={b} liveMatchIds={liveMatchIds} />
            ))}
            {list.length === 0 && (
              <div className="card py-12 text-center text-[13px] text-[var(--color-ink-faint)]">No bets in this category.</div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-3.5">
      <div className="text-[10.5px] text-[var(--color-ink-dim)]">{label}</div>
      <div className={
        tone === "emerald" ? "num text-[16px] font-extrabold text-[var(--color-emerald)] mt-1"
        : tone === "amber" ? "num text-[16px] font-extrabold text-[var(--color-amber)] mt-1"
        : "num text-[16px] font-extrabold mt-1"
      }>{value}</div>
    </div>
  );
}
