"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, ArrowRight, Lock, Zap, ShieldCheck, Check, X, RotateCcw } from "lucide-react";
import { Brand } from "@/components/brand";
import { cn } from "@/lib/utils";
import { formatMoneyWithCurrency } from "@/lib/format-money";

type LegResult = "won" | "lost" | "pending";

type Result = {
  code: string;
  status: LegResult;
  stake: number;
  odds: number;
  payout: number;
  currency?: string;
  legs: { match: string; pick: string; odds: number; result: LegResult }[];
};

// Shape returned by GET /api/bets?code=<code>
type ApiSelection = {
  outcomeLabel?: string;
  odds?: number;
  status?: LegResult;
  match?: { homeTeam?: string; awayTeam?: string };
};
type ApiBet = {
  code: string;
  status: LegResult;
  stake: number;
  totalOdds: number;
  potentialWin: number;
  payout?: number;
  currency?: string;
  selections?: ApiSelection[];
};

export default function VerifyPage() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function verify() {
    const clean = code.trim();
    if (clean.length < 4) {
      setError("Enter a valid verification code.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/bets?code=${encodeURIComponent(clean)}`);
      if (res.status === 404) {
        setError("No ticket found with that code. Check and try again.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't verify right now — please try again.");
        return;
      }
      const data = (await res.json()) as { bet?: ApiBet };
      const bet = data.bet;
      if (!bet) {
        setError("No ticket found with that code. Check and try again.");
        return;
      }
      setResult({
        code: bet.code,
        status: bet.status,
        stake: bet.stake,
        odds: bet.totalOdds,
        payout: bet.payout ?? bet.potentialWin,
        currency: bet.currency,
        legs: (bet.selections ?? []).map((s) => ({
          match: [s.match?.homeTeam, s.match?.awayTeam].filter(Boolean).join(" v ") || "Match",
          pick: s.outcomeLabel || "Selection",
          odds: Number(s.odds) || 0,
          result: s.status ?? "pending",
        })),
      });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden grid place-items-center px-4 py-10">
      {/* animated background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[10%] w-[420px] h-[420px] rounded-full bg-[var(--color-violet)]/20 blur-[100px] animate-[orb_16s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-10%] right-[5%] w-[380px] h-[380px] rounded-full bg-[var(--color-cyan)]/15 blur-[100px] animate-[orb_20s_ease-in-out_infinite]" />
        <div className="absolute top-[40%] left-[55%] w-[300px] h-[300px] rounded-full bg-[var(--color-pink)]/12 blur-[100px] animate-[orb_24s_ease-in-out_infinite]" />
      </div>

      <Link href="/" className="absolute top-5 left-5 z-10">
        <Brand size={30} />
      </Link>

      <div className="relative w-full max-w-[460px]">
        {!result ? (
          <div className="grad-border animate-rise">
            <div className="relative p-7 sm:p-9 text-center">
              {/* shield */}
              <div className="relative mx-auto w-20 h-20 mb-6">
                <span className="absolute inset-0 rounded-full border border-[var(--color-violet)]/30 animate-ping" />
                <span className="absolute inset-2 rounded-full border border-[var(--color-cyan)]/20" />
                <span className="absolute inset-0 grid place-items-center">
                  <Shield size={44} className="text-[var(--color-violet)]" strokeWidth={1.5} />
                  <Check size={18} className="absolute text-[var(--color-emerald)]" strokeWidth={3} />
                </span>
              </div>

              <h1 className="font-display font-extrabold text-[22px]">Verify Your Ticket</h1>
              <p className="text-[13px] text-[var(--color-ink-dim)] mt-2 leading-relaxed">
                Enter your verification code to confirm authenticity and check results in real time.
              </p>

              <div className={cn("relative mt-6 flex items-center rounded-2xl border bg-[var(--color-surface)] transition", error ? "border-[var(--color-rose)]/60" : "border-[var(--color-line)] focus-within:border-[var(--color-violet)]/60 focus-within:glow-violet")}>
                <Lock size={16} className="ml-4 text-[var(--color-ink-faint)]" />
                <input
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && verify()}
                  placeholder="Enter verification code"
                  className="flex-1 bg-transparent num text-[14px] tracking-wider px-3 py-4 outline-none placeholder:text-[var(--color-ink-faint)] placeholder:tracking-normal placeholder:font-sans"
                />
                <button
                  onClick={verify}
                  disabled={loading}
                  className="m-1.5 flex items-center gap-1.5 rounded-xl grad-violet-pink text-white px-4 py-2.5 font-display font-bold text-[13px] active:scale-95 transition disabled:opacity-60"
                >
                  {loading ? (
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-[spin_0.8s_linear_infinite]" />
                  ) : (
                    <>Verify <ArrowRight size={15} /></>
                  )}
                </button>
              </div>

              {error && <p className="text-[12px] text-[var(--color-rose)] mt-2.5 flex items-center justify-center gap-1.5"><X size={13} /> {error}</p>}

              <div className="grid grid-cols-3 gap-2 mt-7 pt-6 border-t border-[var(--color-line)]">
                <Feature icon={<ShieldCheck size={18} />} title="Authentic" sub="Genuine ticket" />
                <Feature icon={<Zap size={18} />} title="Instant" sub="Real-time" />
                <Feature icon={<Lock size={18} />} title="Private" sub="Protected" />
              </div>
            </div>
          </div>
        ) : (
          <ResultCard r={result} onReset={() => { setResult(null); setCode(""); }} />
        )}
      </div>
    </div>
  );
}

function Feature({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[var(--color-violet)]">{icon}</span>
      <span className="font-display font-bold text-[12px]">{title}</span>
      <span className="text-[10px] text-[var(--color-ink-faint)]">{sub}</span>
    </div>
  );
}

function ResultCard({ r, onReset }: { r: Result; onReset: () => void }) {
  const wonLegs = r.legs.filter((l) => l.result === "won").length;
  return (
    <div className="grad-border animate-rise">
      <div className="relative p-6 sm:p-7">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--color-emerald)]/12 text-[var(--color-emerald)]">
              <ShieldCheck size={20} />
            </span>
            <div>
              <div className="font-display font-extrabold text-[15px]">Ticket Verified</div>
              <div className="num text-[11px] text-[var(--color-cyan)]">{r.code}</div>
            </div>
          </div>
          <span className={cn(
            "chip px-2.5 py-1",
            r.status === "won" && "bg-[var(--color-emerald)]/12 border-[var(--color-emerald)]/30 text-[var(--color-emerald)]",
            r.status === "lost" && "bg-[var(--color-rose)]/12 border-[var(--color-rose)]/30 text-[var(--color-rose)]",
            r.status === "pending" && "bg-[var(--color-amber)]/12 border-[var(--color-amber)]/30 text-[var(--color-amber)]",
          )}>
            {r.status === "won" ? "🏆 Won" : r.status === "lost" ? "❌ Lost" : "⏳ In Progress"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <Box label="Stake" value={formatMoneyWithCurrency(r.stake, r.currency)} />
          <Box label="Total Odds" value={`@ ${r.odds.toFixed(2)}`} />
          <Box label="Potential" value={formatMoneyWithCurrency(r.payout, r.currency)} grad />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">
            <span>Selections</span>
            <span className="text-[var(--color-emerald)]">{wonLegs}/{r.legs.length} won</span>
          </div>
          {r.legs.map((l, i) => (
            <div key={i} className="flex items-center gap-3 card p-3">
              <span className={cn(
                "grid place-items-center w-7 h-7 rounded-lg shrink-0",
                l.result === "won" && "bg-[var(--color-emerald)]/12 text-[var(--color-emerald)]",
                l.result === "lost" && "bg-[var(--color-rose)]/12 text-[var(--color-rose)]",
                l.result === "pending" && "bg-[var(--color-amber)]/12 text-[var(--color-amber)]",
              )}>
                {l.result === "won" ? <Check size={15} /> : l.result === "lost" ? <X size={15} /> : <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold text-[12.5px] truncate">{l.pick}</div>
                <div className="text-[10.5px] text-[var(--color-ink-faint)] truncate">{l.match}</div>
              </div>
              <span className="num text-[12px] font-bold shrink-0">{l.odds.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <button onClick={onReset} className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--color-line)] py-3 text-[13px] font-semibold text-[var(--color-ink-dim)] hover:text-white transition">
          <RotateCcw size={15} /> Verify Another Ticket
        </button>
      </div>
    </div>
  );
}

function Box({ label, value, grad }: { label: string; value: string; grad?: boolean }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-[9.5px] uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</div>
      <div className={cn("num text-[14px] font-extrabold mt-1", grad && "grad-text")}>{value}</div>
    </div>
  );
}
