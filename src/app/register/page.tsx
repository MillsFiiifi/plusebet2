"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { AuthShell, Field } from "@/components/auth-shell";
import { saveUserSession } from "@/lib/user-session";

const COUNTRIES = [
  { dial: "233", iso: "GH", flag: "🇬🇭", kyc: "Ghana Card number", kycHint: "GHA-XXXXXXXXX-X", needsKyc: true },
  { dial: "234", iso: "NG", flag: "🇳🇬", kyc: "BVN or NIN", kycHint: "11 digits", needsKyc: true },
  { dial: "254", iso: "KE", flag: "🇰🇪", kyc: "National ID number", kycHint: "7–8 digits", needsKyc: true },
  { dial: "27", iso: "ZA", flag: "🇿🇦", kyc: "ID number", kycHint: "13 digits", needsKyc: true },
  { dial: "256", iso: "UG", flag: "🇺🇬", kyc: "National ID (NIN)", kycHint: "NIN number", needsKyc: true },
  { dial: "255", iso: "TZ", flag: "🇹🇿", kyc: "National ID", kycHint: "ID number", needsKyc: true },
  { dial: "237", iso: "CM", flag: "🇨🇲", kyc: "National ID", kycHint: "ID number", needsKyc: true },
  { dial: "260", iso: "ZM", flag: "🇿🇲", kyc: "National ID", kycHint: "ID number", needsKyc: true },
  { dial: "225", iso: "CI", flag: "🇨🇮", kyc: "National ID", kycHint: "ID number", needsKyc: true },
  { dial: "250", iso: "RW", flag: "🇷🇼", kyc: "National ID", kycHint: "ID number", needsKyc: true },
  { dial: "1", iso: "US", flag: "🇺🇸", kyc: "SSN (last 4)", kycHint: "last 4 digits", needsKyc: true },
  { dial: "44", iso: "GB", flag: "🇬🇧", kyc: "ID number", kycHint: "ID number", needsKyc: true },
] as const;

const inputCls =
  "w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-[var(--color-violet)]/60 focus:glow-violet transition placeholder:text-[var(--color-ink-faint)]";

export default function RegisterPage() {
  const [show, setShow] = useState(false);
  const [agree, setAgree] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [dial, setDial] = useState("233");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kyc, setKyc] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referral, setReferral] = useState("");
  // When the code came from a partner's referral link it's locked — the new
  // user can't change whose referral they signed up under.
  const [referralLocked, setReferralLocked] = useState(false);
  const router = useRouter();

  // Pick up a partner referral code from /register?ref=CODE and lock it.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && ref.trim()) {
      setReferral(ref.trim().toUpperCase());
      setReferralLocked(true);
    }
  }, []);

  const country = COUNTRIES.find((c) => c.dial === dial) ?? COUNTRIES[0];
  // Only show the KYC field for countries that strictly require it. (Ghana no
  // longer collects the Ghana Card at signup.)
  const showKyc = country.needsKyc;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (showKyc && !kyc.trim()) {
      setError(`${country.kyc} is required`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${first.trim()} ${last.trim()}`.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          country: country.iso,
          kyc: kyc.trim() || undefined,
          referralCode: referral || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }
      saveUserSession(data.user.id, data.user.name);
      router.push("/account");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Create your account" subtitle="Open an account in under a minute.">
      <form onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First Name">
            <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" className={inputCls} />
          </Field>
          <Field label="Last Name">
            <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" className={inputCls} />
          </Field>
        </div>

        <Field label="Phone Number">
          <div className="flex gap-2">
            <select
              value={dial}
              onChange={(e) => setDial(e.target.value)}
              className="bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-2.5 py-3 text-[14px] outline-none focus:border-[var(--color-violet)]/60 w-[92px]"
            >
              {COUNTRIES.map((c) => (
                <option key={c.dial} value={c.dial}>{c.flag} +{c.dial}</option>
              ))}
            </select>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 XXX XXXX"
              className={"flex-1 " + inputCls}
            />
          </div>
        </Field>

        <Field label="Email Address">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
        </Field>

        {showKyc && (
          <Field label={country.kyc}>
            <input value={kyc} onChange={(e) => setKyc(e.target.value)} placeholder={country.kycHint} className={inputCls} />
          </Field>
        )}

        <Field label="Password">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete="new-password"
              className={inputCls + " pr-11"}
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-white">
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </Field>

        <Field label={referralLocked ? "Referral code (from your invite)" : "Referral code (optional)"}>
          <input
            value={referral}
            onChange={(e) => setReferral(e.target.value.toUpperCase())}
            placeholder="Partner code"
            readOnly={referralLocked}
            aria-readonly={referralLocked}
            tabIndex={referralLocked ? -1 : undefined}
            className={
              inputCls +
              " font-mono tracking-widest" +
              (referralLocked ? " opacity-70 cursor-not-allowed pointer-events-none" : "")
            }
          />
          {referralLocked && (
            <p className="mt-1.5 text-[11.5px] text-[var(--color-ink-faint)]">
              Applied from your partner&apos;s invite link — this can&apos;t be changed.
            </p>
          )}
        </Field>

        {error && (
          <p className="mb-2 text-[12.5px] font-semibold text-[var(--color-rose,#fb7185)]">{error}</p>
        )}

        <button
          type="button"
          onClick={() => setAgree((v) => !v)}
          className="flex items-start gap-2.5 my-4 text-left"
        >
          <span className={`grid place-items-center w-5 h-5 rounded-md border shrink-0 mt-0.5 transition ${agree ? "grad-violet-pink border-transparent" : "border-[var(--color-line-2)]"}`}>
            {agree && <Check size={13} className="text-white" />}
          </span>
          <span className="text-[12px] text-[var(--color-ink-dim)] leading-relaxed">
            I&apos;m 18+ and agree to the <span className="text-[var(--color-cyan)]">Terms</span> and <span className="text-[var(--color-cyan)]">Privacy Policy</span>.
          </span>
        </button>

        <button
          type="submit"
          disabled={!agree || loading}
          className="w-full rounded-xl py-3.5 font-display font-extrabold text-[14px] grad-violet-pink text-white shadow-[0_10px_30px_-8px_rgba(236,72,153,.5)] disabled:opacity-50 disabled:shadow-none active:scale-[.99] transition flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {loading ? "Creating…" : "Create Account"}
        </button>

        <p className="text-center text-[13px] text-[var(--color-ink-dim)] mt-5">
          Already have an account? <Link href="/login" className="font-bold text-[var(--color-violet)] hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
