"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ArrowDownToLine, History, Receipt, X, Check, Loader2, LogOut, KeyRound, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { formatMoneyWithCurrency } from "@/lib/format-money";
import { GoalAlertsToggle } from "@/components/goal-alerts-toggle";
import { getUserId, clearUserSession } from "@/lib/user-session";
import { getCountryForCurrency, getMinFirstDeposit, isCurrencyCode } from "@/lib/countries";

interface AccountUser {
  id: string;
  name: string;
  currency: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  verificationStep: number;
  withdrawalApproved: boolean;
  phone: string | null;
  firstDepositAt?: string | null;
}

// Mobile-money networks. Moolre's channel auto-detects the network from the
// number, so this is for the customer to confirm their wallet.
const NETWORKS = [
  { id: "mtn", name: "MTN MoMo", logo: "/networks/mtn.svg" },
  { id: "vod", name: "TELECEL CASH", logo: "/networks/telecel.svg" },
  { id: "atl", name: "AirtelTigo", logo: "/networks/airteltigo.svg" },
] as const;

// Manual-deposit agent accounts shown on the deposit screen (each with its
// network logo). Customers see the accounts for their own country and pay any
// one, then upload the screenshot.
const DEPOSIT_ACCOUNTS = [
  { country: "GH", name: "Adjei Bright", number: "0502470854", network: "TELECEL CASH", logo: "/networks/telecel.svg" },
  { country: "GH", name: "KOJO MABIGMAN", number: "0534922921", network: "MTN MoMo", logo: "/networks/mtn.svg" },
  { country: "NG", name: "Onwueme Hilary", number: "2043162107", network: "Kuda Microfinance Bank", logo: "/networks/kuda.svg", flag: "/flags/nigeria.svg" },
] as const;

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [noSession, setNoSession] = useState(false);
  const [modal, setModal] = useState<null | "deposit" | "withdraw">(null);
  const [pwOpen, setPwOpen] = useState(false);
  // Banner shown when the user returns from the Moolre checkout (?moolre=...).
  const [returnMsg, setReturnMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const id = getUserId();
    if (!id) {
      setNoSession(true);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/users/${id}`);
      if (res.status === 404) {
        clearUserSession();
        setNoSession(true);
        return;
      }
      const data = await res.json();
      setUser(data);
    } catch {
      /* keep last known state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Safety net: on load, credit any Moolre deposit that settled while the user
  // was away (poll timed out / page closed). Refresh the balance if it credits.
  useEffect(() => {
    const id = getUserId();
    if (!id) return;
    fetch("/api/payments/moolre/direct/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.credited > 0) void refresh(); })
      .catch(() => {});
  }, [refresh]);

  // Same safety net for Korapay (GH + NG). There's no webhook on these
  // accounts, so this load-time sweep is the backstop that credits any deposit
  // whose redirect callback never fired.
  useEffect(() => {
    const id = getUserId();
    if (!id) return;
    fetch("/api/payments/korapay/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.credited > 0) void refresh(); })
      .catch(() => {});
  }, [refresh]);

  // Same safety net for Flutterwave (the main gateway).
  useEffect(() => {
    const id = getUserId();
    if (!id) return;
    fetch("/api/payments/flutterwave/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.credited > 0) void refresh(); })
      .catch(() => {});
  }, [refresh]);

  // Show a result banner when Moolre sends the player back here after checkout.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("moolre");
    if (!status) return;
    const ok = status === "success" || status === "already-credited";
    setReturnMsg({
      ok,
      text: ok
        ? "Deposit successful — your balance has been updated."
        : "Your deposit wasn't completed. If you were charged, it'll reflect shortly.",
    });
    // Drop the ?moolre param so it doesn't re-show on refresh, and re-pull balance.
    window.history.replaceState(null, "", window.location.pathname);
    void refresh();
  }, [refresh]);

  // Same banner for the Korapay hosted-checkout return (?korapay=...).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("korapay");
    if (!status) return;
    const ok = status === "success" || status === "already-credited";
    setReturnMsg({
      ok,
      text: ok
        ? "Deposit successful — your balance has been updated."
        : "Your deposit wasn't completed. If you were charged, it'll reflect shortly.",
    });
    window.history.replaceState(null, "", window.location.pathname);
    void refresh();
  }, [refresh]);

  // Same banner for the Flutterwave hosted-checkout return (?flutterwave=...).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("flutterwave");
    if (!status) return;
    const ok = status === "success" || status === "already-credited";
    setReturnMsg({
      ok,
      text: ok
        ? "Deposit successful — your balance has been updated."
        : "Your deposit wasn't completed. If you were charged, it'll reflect shortly.",
    });
    window.history.replaceState(null, "", window.location.pathname);
    void refresh();
  }, [refresh]);

  function signOut() {
    clearUserSession();
    router.push("/login");
  }

  const initials = user?.name
    ? user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
    : "—";
  const cur = user?.currency ?? "GHS";
  const money = (n: number) => formatMoneyWithCurrency(n, cur);

  if (loading) {
    return (
      <AppShell tabs={false}>
        <div className="grid place-items-center py-32 text-[var(--color-ink-dim)]">
          <Loader2 size={26} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (noSession) {
    return (
      <AppShell tabs={false}>
        <div className="card p-10 text-center max-w-md mx-auto mt-10">
          <h2 className="font-display font-extrabold text-[19px]">You&apos;re not signed in</h2>
          <p className="text-[13px] text-[var(--color-ink-dim)] mt-2">Sign in to view your wallet, deposit, and withdraw.</p>
          <div className="flex gap-3 justify-center mt-6">
            <Link href="/login" className="rounded-xl px-5 py-3 font-display font-bold grad-violet-pink text-white text-sm">Sign In</Link>
            <Link href="/register" className="rounded-xl px-5 py-3 font-display font-bold border border-[var(--color-line)] text-sm">Create account</Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell tabs={false}>
      {returnMsg && (
        <div
          className={cn(
            "mb-4 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] font-semibold",
            returnMsg.ok
              ? "border-[var(--color-emerald)]/30 bg-[var(--color-emerald)]/10 text-[var(--color-emerald)]"
              : "border-[var(--color-amber)]/30 bg-[var(--color-amber)]/10 text-[var(--color-amber)]",
          )}
        >
          {returnMsg.ok ? <Check size={16} /> : <span>⚠️</span>}
          <span className="flex-1">{returnMsg.text}</span>
          <button onClick={() => setReturnMsg(null)} className="opacity-70 hover:opacity-100"><X size={15} /></button>
        </div>
      )}

      {/* hero */}
      <div className="grad-border overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-[var(--color-violet)]/15 blur-3xl" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="flex items-center gap-4">
              <div className="grid place-items-center w-16 h-16 rounded-2xl grad-violet-pink text-white font-display font-extrabold text-[22px]">{initials}</div>
              <div>
                <div className="text-[11px] text-[var(--color-ink-dim)]">Welcome back</div>
                <div className="font-display font-extrabold text-[19px]">{user?.name}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <button onClick={signOut} className="chip px-2 py-0.5 inline-flex items-center gap-1 text-[var(--color-ink-dim)] hover:text-white">
                    <LogOut size={11} /> Sign out
                  </button>
                </div>
              </div>
            </div>
            <div className="sm:ml-auto flex items-center gap-3 sm:justify-end">
              <div className="sm:text-right">
                <div className="text-[11px] text-[var(--color-ink-dim)]">Available Balance</div>
                <div className="num text-[30px] font-extrabold grad-text leading-tight">{money(user?.balance ?? 0)}</div>
              </div>
              {user?.firstDepositAt && (
                <div className="shrink-0 rounded-2xl px-3.5 py-2.5 text-center border border-[var(--color-amber)]/35 bg-[var(--color-amber)]/10">
                  <div className="text-[15px] leading-none">🎁</div>
                  <div className="num text-[15px] font-extrabold text-[var(--color-amber)] mt-1 leading-none">{money(100)}</div>
                  <div className="text-[9px] uppercase tracking-wide text-[var(--color-ink-dim)] mt-1">Bonus</div>
                </div>
              )}
            </div>
          </div>

          <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
            <Action onClick={() => setModal("deposit")} primary icon={<Plus size={16} />} label="Deposit" />
            <Action onClick={() => setModal("withdraw")} icon={<ArrowDownToLine size={16} />} label="Withdraw" />
            <ActionLink href="/bet-history" icon={<History size={16} />} label="Bet History" />
            <ActionLink href="/transactions" icon={<Receipt size={16} />} label="Transactions" />
          </div>
        </div>
      </div>

      {/* KPIs from real wallet totals */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
        <Kpi icon="💰" tone="emerald" val={money(user?.totalDeposited ?? 0)} label="Total Deposited" />
        <Kpi icon="🏧" tone="cyan" val={money(user?.totalWithdrawn ?? 0)} label="Total Withdrawn" />
        <Kpi icon="🔓" tone="rose" val={user?.withdrawalApproved ? "Enabled" : "Pending"} label="Withdrawals" />
      </div>

      {/* live goal alerts opt-in */}
      <div className="mt-4">
        <GoalAlertsToggle />
      </div>

      {/* recent activity */}
      <div className="card p-4 mt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="title-bar" />
            <h2 className="font-display font-extrabold text-[15px]">Recent Activity</h2>
          </div>
          <Link href="/transactions" className="text-[11.5px] font-semibold text-[var(--color-cyan)] hover:underline">View all →</Link>
        </div>
        <p className="text-[13px] text-[var(--color-ink-dim)] py-6 text-center">
          Your deposits, withdrawals, and bet activity appear on the{" "}
          <Link href="/transactions" className="text-[var(--color-cyan)] hover:underline">transactions</Link> page.
        </p>
      </div>

      {/* security */}
      <div className="card p-4 mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--color-violet)]/12 shrink-0">
              <KeyRound size={16} className="text-[var(--color-violet)]" />
            </span>
            <div className="min-w-0">
              <div className="font-display font-bold text-[13.5px]">Password</div>
              <div className="text-[11.5px] text-[var(--color-ink-dim)] truncate">Change the password you use to sign in.</div>
            </div>
          </div>
          <button
            onClick={() => setPwOpen(true)}
            className="shrink-0 rounded-xl px-4 py-2 text-[12.5px] font-bold border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-dim)] hover:text-white hover:border-[var(--color-line-2)] transition"
          >
            Change
          </button>
        </div>
      </div>

      {modal && user && (
        <PaymentModal
          type={modal}
          user={user}
          onClose={() => setModal(null)}
          onSuccess={() => { void refresh(); }}
          onSwitchToDeposit={() => setModal("deposit")}
        />
      )}

      {pwOpen && user && (
        <ChangePasswordModal userId={user.id} onClose={() => setPwOpen(false)} />
      )}
    </AppShell>
  );
}

function Kpi({ icon, tone, val, label }: { icon: string; tone: string; val: string; label: string }) {
  return (
    <div className="card p-4">
      <span className={cn("grid place-items-center w-9 h-9 rounded-xl text-[16px] mb-3",
        tone === "gold" && "bg-[var(--color-amber)]/12",
        tone === "emerald" && "bg-[var(--color-emerald)]/12",
        tone === "cyan" && "bg-[var(--color-cyan)]/12",
        tone === "rose" && "bg-[var(--color-rose)]/12",
      )}>{icon}</span>
      <div className="num text-[18px] font-extrabold truncate">{val}</div>
      <div className="text-[11px] text-[var(--color-ink-dim)] mt-0.5">{label}</div>
    </div>
  );
}

function Action({ onClick, icon, label, primary }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold transition",
        primary ? "grad-violet-pink text-white shadow-[0_8px_24px_-8px_rgba(236,72,153,.5)] hover:brightness-110"
          : "border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-dim)] hover:text-white hover:border-[var(--color-line-2)]",
      )}
    >
      {icon} {label}
    </button>
  );
}

function ActionLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-dim)] hover:text-white hover:border-[var(--color-line-2)] transition"
    >
      {icon} {label}
    </Link>
  );
}

function PaymentModal({
  type,
  user,
  onClose,
  onSuccess,
  onSwitchToDeposit,
}: {
  type: "deposit" | "withdraw";
  user: AccountUser;
  onClose: () => void;
  onSuccess: () => void;
  onSwitchToDeposit?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [network, setNetwork] = useState<(typeof NETWORKS)[number]["id"]>("mtn");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // OTP step: once set, the gateway texted a code we collect on our own screen.
  const [otpRef, setOtpRef] = useState<string | null>(null);
  // Which gateway the pending OTP belongs to — decides where submitOtp posts.
  const [otpGateway, setOtpGateway] = useState<"moolre" | "flutterwave" | "payseed">("moolre");
  const [otp, setOtp] = useState("");
  // When a gateway needs the customer on its own secure page, we show a clear
  // hand-off screen (with this URL) instead of silently redirecting them.
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  // Nigeria PaySeed bank transfer — the virtual account to display + poll on.
  const [bankAccount, setBankAccount] = useState<{
    bank_name?: string;
    account_number?: string;
    account_name?: string;
    expires_at?: string;
  } | null>(null);
  const [diag, setDiag] = useState(""); // temp: shows Moolre's raw reply on screen
  // Manual deposit: customer pays our MoMo number and uploads the screenshot.
  const [file, setFile] = useState<File | null>(null);
  const [copiedNum, setCopiedNum] = useState<string | null>(null);
  const cc = isCurrencyCode(user.currency) ? user.currency : "GHS";
  const userCountry = getCountryForCurrency(cc).code;
  // GH uses Moolre's automated checkout; other countries use the manual
  // pay-an-agent + upload-screenshot flow.
  const useMoolre = getCountryForCurrency(cc).gateway === "moolre";
  // Korapay hosted checkout (Ghana + Nigeria): mint a one-time checkout URL and
  // redirect the player there. Auto-credits on return via callback + webhook.
  const useKorapay = getCountryForCurrency(cc).gateway === "korapay";
  // Flutterwave — the MAIN gateway. Ghana uses our OWN branded MoMo checkout
  // (direct charge + phone prompt, no hosted page); Nigeria uses the hosted
  // redirect (card / bank / USSD). Korapay is the automatic fallback.
  const useFlutterwave = getCountryForCurrency(cc).gateway === "flutterwave";
  const useFlutterwaveMomo = useFlutterwave && cc === "GHS";
  const useFlutterwaveHosted = useFlutterwave && cc !== "GHS";
  // Paystack mobile-money checkout. NETWORK ids (mtn/vod/atl) are
  // Paystack's GH provider codes, sent as `provider` to the start endpoint.
  const usePaystackMomo = getCountryForCurrency(cc).gateway === "paystack";
  // PaySeed — the gateway for GH + NG. Ghana uses our own in-app MoMo checkout
  // (charge + phone prompt / OTP, no hosted page, same UX as the Flutterwave
  // MoMo flow); Nigeria uses a bank-transfer virtual account.
  const usePayseed = getCountryForCurrency(cc).gateway === "payseed";
  const usePayseedMomo = usePayseed && cc === "GHS";
  const usePayseedBank = usePayseed && cc !== "GHS";
  // In-app MoMo UI (network picker + phone) is shared by the Flutterwave and
  // PaySeed Ghana flows.
  const useMomoForm = useFlutterwaveMomo || usePayseedMomo;
  // Hosted redirect checkouts (Moolre, Korapay, Flutterwave-NG) skip the
  // agent-account + screenshot UI: the player pays on the gateway page and we
  // credit on return.
  const useHostedCheckout = useMoolre || useKorapay || useFlutterwaveHosted;
  const minDeposit = getMinFirstDeposit(userCountry);
  // Show the deposit accounts for the user's country; fall back to all if none
  // are configured for their country (so deposits are never blocked).
  const byCountry = DEPOSIT_ACCOUNTS.filter((a) => a.country === userCountry);
  const accounts = byCountry.length > 0 ? byCountry : DEPOSIT_ACCOUNTS;
  const quick =
    type === "deposit"
      ? [minDeposit, minDeposit * 2, minDeposit * 5, minDeposit * 10]
      : [100, 200, 500, 1000];
  const amt = parseFloat(amount);
  const money = (n: number) => formatMoneyWithCurrency(n, user.currency);
  const belowMin = type === "deposit" && amt > 0 && amt < minDeposit;
  // Networks authorize differently: MTN/AirtelTigo push a PIN prompt; Telecel
  // Cash is approved by the customer dialing *110#.
  const approvalHint =
    network === "vod"
      ? "On your phone, dial *110# → approve the payment to complete your deposit."
      : network === "atl"
        ? "Approve the AirtelTigo Money prompt on your phone to complete your deposit."
        : "Approve the MTN MoMo prompt with your PIN to complete your deposit.";

  async function pollDeposit(reference: string) {
    const TERMINAL_FAIL = [
      "failed", "status-failed", "no-user", "credit-failed", "unknown-reference",
    ];
    // Poll up to ~4 minutes — Telecel (*110#) approvals can be slow.
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/payments/moolre/direct/status?reference=${encodeURIComponent(reference)}`);
        const data = await res.json();
        const s = data.status as string;
        if (s === "success" || s === "already-credited") { setDone(true); onSuccess(); return; }
        if (TERMINAL_FAIL.includes(s)) { setError("Payment was not completed. Please try again."); return; }
        setStatus("Waiting for your approval — " + approvalHint);
      } catch {
        /* transient — keep polling */
      }
    }
    setError("Still waiting for confirmation. If you approved the payment, your balance will update once it settles — refresh in a minute.");
  }

  function copyNumber(num: string) {
    navigator.clipboard?.writeText(num).then(() => {
      setCopiedNum(num);
      setTimeout(() => setCopiedNum(null), 1800);
    }).catch(() => {});
  }

  // Route the deposit to the right flow for the user's country.
  async function deposit() {
    if (usePayseedMomo) return depositPayseedMomo();
    if (usePayseedBank) return depositPayseedBank();
    if (useMoolre) return depositMoolre();
    if (useFlutterwaveMomo) return depositFlutterwaveV4Momo();
    if (useFlutterwaveHosted) return depositFlutterwave();
    if (useKorapay) return depositKorapay();
    if (usePaystackMomo) return depositPaystackMomo();
    return depositManual();
  }

  // PaySeed poll — re-verifies by PaySeed id and credits on success.
  async function pollPayseed(reference: string) {
    const TERMINAL_FAIL = [
      "failed", "reversed", "amount-mismatch", "currency-mismatch", "verify-failed",
      "no-user", "credit-failed", "unknown-reference", "missing-payseed-id",
    ];
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/payments/payseed/status?reference=${encodeURIComponent(reference)}`);
        const data = await res.json();
        const s = data.status as string;
        if (s === "success" || s === "already-credited") { setDone(true); onSuccess(); return; }
        if (TERMINAL_FAIL.includes(s)) { setError("Payment was not completed. Please try again."); return; }
        setStatus("Waiting for your approval — " + approvalHint);
      } catch {
        /* transient — keep polling */
      }
    }
    setError("Still waiting for confirmation. If you approved the payment, your balance will update once it settles — refresh in a minute.");
  }

  // Ghana MoMo via PaySeed — charge on our own screen, OTP if the network needs
  // it, then poll while the player approves the phone prompt.
  async function depositPayseedMomo() {
    if (!phone.trim()) {
      setError("Enter your mobile money number.");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("Starting mobile money deposit…");
    try {
      const res = await fetch("/api/payments/payseed/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, phone: phone.trim(), network, returnPath: "/account" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reference) {
        console.error("[deposit] payseed momo start failed:", data.error);
        setError("We couldn't start your Mobile Money deposit right now. Please try again in a moment.");
        return;
      }
      if (data.otpRequired) {
        setOtpGateway("payseed");
        setOtpRef(data.reference as string);
        setStatus("");
        return;
      }
      if (data.redirect) {
        setRedirectUrl(data.redirect as string);
        setStatus("");
        return;
      }
      setStatus("Approve the prompt on your phone to complete your deposit.");
      await pollPayseed(data.reference);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Nigeria via PaySeed — create a bank-transfer virtual account, show the
  // details to the customer, then poll until PaySeed confirms the transfer.
  async function depositPayseedBank() {
    setError(null);
    setBusy(true);
    setStatus("Setting up your bank transfer…");
    try {
      const res = await fetch("/api/payments/payseed/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, returnPath: "/account" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reference) {
        console.error("[deposit] payseed bank start failed:", data.error);
        setError("We couldn't start your deposit right now. Please try again in a moment.");
        return;
      }
      if (data.redirect) {
        setRedirectUrl(data.redirect as string);
        setStatus("");
        return;
      }
      if (data.account) {
        setBankAccount(data.account);
        setStatus("");
        await pollPayseed(data.reference);
        return;
      }
      setStatus("Complete the transfer to fund your account.");
      await pollPayseed(data.reference);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Custom Ghana MoMo checkout: charge Flutterwave directly and poll while the
  // player approves the prompt on their phone — all on our own screen. Falls
  // back to Korapay if the charge can't start.
  async function pollFlutterwaveMomo(reference: string) {
    const TERMINAL_FAIL = [
      "failed", "amount-mismatch", "currency-mismatch", "verify-failed",
      "no-user", "credit-failed", "unknown-reference",
    ];
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/payments/flutterwave/momo/status?reference=${encodeURIComponent(reference)}`);
        const data = await res.json();
        const s = data.status as string;
        if (s === "success" || s === "already-credited") { setDone(true); onSuccess(); return; }
        if (TERMINAL_FAIL.includes(s)) { setError("Payment was not completed. Please try again."); return; }
        setStatus("Waiting for your approval — " + approvalHint);
      } catch {
        /* transient — keep polling */
      }
    }
    setError("Still waiting for confirmation. If you approved the payment, your balance will update once it settles — refresh in a minute.");
  }

  // Flutterwave V4 Ghana MoMo — the current flow. V4 authorises with a PIN
  // PROMPT on the customer's phone (no OTP, no WhatsApp code); we just poll.
  async function pollFlutterwaveV4Momo(reference: string) {
    const TERMINAL_FAIL = [
      "failed", "amount-mismatch", "currency-mismatch", "verify-failed",
      "no-user", "credit-failed", "unknown-reference", "no-charge-id",
    ];
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/payments/flutterwave-v4/momo/status?reference=${encodeURIComponent(reference)}`);
        const data = await res.json();
        const s = data.status as string;
        if (s === "success" || s === "already-credited") { setDone(true); onSuccess(); return; }
        if (TERMINAL_FAIL.includes(s)) { setError("Payment was not completed. Please try again."); return; }
        setStatus("Waiting for your approval — enter your Mobile Money PIN on your phone.");
      } catch {
        /* transient — keep polling */
      }
    }
    setError("Still waiting for confirmation. If you approved the payment, your balance will update once it settles — refresh in a minute.");
  }

  async function depositFlutterwaveV4Momo() {
    if (!phone.trim()) {
      setError("Enter your mobile money number.");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("Starting mobile money deposit…");
    try {
      const res = await fetch("/api/payments/flutterwave-v4/momo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, phone: phone.trim(), network }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reference) {
        console.error("[deposit] flutterwave v4 momo start failed:", data.error);
        setError(data.error ?? "We couldn't start your Mobile Money deposit right now. Please try again in a moment.");
        return;
      }
      setStatus(data.instruction ?? "Approve the prompt on your phone (enter your Mobile Money PIN) to complete your deposit.");
      await pollFlutterwaveV4Momo(data.reference);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function depositFlutterwaveMomo() {
    if (!phone.trim()) {
      setError("Enter your mobile money number.");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("Starting mobile money deposit…");
    try {
      const res = await fetch("/api/payments/flutterwave/momo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, phone: phone.trim(), network, purpose: "deposit" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reference) {
        console.error("[deposit] flutterwave momo start failed:", data.error);
        setError("We couldn't start your Mobile Money deposit right now. Please try again in a moment.");
        return;
      }
      // OTP mode: the network texted a code — collect it on our own screen.
      if (data.otpRequired) {
        setOtpGateway("flutterwave");
        setOtpRef(data.reference as string);
        setStatus("");
        return;
      }
      // Voucher/redirect networks still hand off to Flutterwave's page — show a
      // clear branded interstitial first so the customer isn't confused.
      if (data.redirect) {
        setRedirectUrl(data.redirect as string);
        setStatus("");
        return;
      }
      setStatus("Approve the prompt on your phone to complete your deposit.");
      await pollFlutterwaveMomo(data.reference);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Flutterwave (GH + NG) is the ONLY gateway: mint a hosted-checkout URL and
  // send the customer there. If Flutterwave can't start, show a clear error —
  // no Korapay fallback (that merchant is deactivated).
  async function depositFlutterwave() {
    setError(null);
    setBusy(true);
    setStatus("Opening secure checkout…");
    try {
      const res = await fetch("/api/payments/flutterwave/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, returnPath: "/account" }),
      });
      const data: { url?: string; error?: string } = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      console.error("[deposit] flutterwave start failed:", data.error);
      setError("We couldn't open the secure checkout right now. Please try again in a moment.");
      setBusy(false);
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  // Korapay (GH + NG): mint a one-time hosted-checkout URL and send the customer
  // there. The callback re-verifies and auto-credits on return; the signed
  // webhook is the backstop if they close the tab before redirecting.
  async function depositKorapay() {
    setError(null);
    setBusy(true);
    setStatus("Opening secure checkout…");
    try {
      const res = await fetch("/api/payments/korapay/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, returnPath: "/account" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start the deposit.");
        setBusy(false);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  async function pollPaystackMomo(reference: string) {
    const TERMINAL_FAIL = [
      "failed", "abandoned", "amount-mismatch", "verify-failed", "no-user", "credit-failed", "missing-reference", "unknown-reference",
    ];
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/payments/paystack/momo/status?reference=${encodeURIComponent(reference)}`);
        const data = await res.json();
        const s = data.status as string;
        if (s === "success" || s === "already-credited") { setDone(true); onSuccess(); return; }
        if (TERMINAL_FAIL.includes(s)) { setError("Payment was not completed. Please try again."); return; }
        setStatus("Waiting for your approval — " + approvalHint);
      } catch {
        /* transient — keep polling */
      }
    }
    setError("Still waiting for confirmation. If you approved the payment, your balance will update once it settles — refresh in a minute.");
  }

  async function depositPaystackMomo() {
    if (!phone.trim()) {
      setError("Enter your mobile money number.");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("Starting mobile money deposit…");
    try {
      const res = await fetch("/api/payments/paystack/momo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, phone: phone.trim(), provider: network, purpose: "deposit" }),
      });
      const data = await res.json();
      if (!res.ok || !data.reference) {
        setError(data.error ?? "Could not start the deposit.");
        setBusy(false);
        return;
      }
      setStatus(data.displayText ?? "Waiting for approval on your phone...");
      await pollPaystackMomo(data.reference);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Moolre (GH): mint a hosted-checkout URL and send the customer there to pay
  // with MoMo. Moolre confirms + auto-credits on return.
  async function depositMoolre() {
    setError(null);
    setBusy(true);
    setStatus("Opening secure checkout…");
    try {
      const res = await fetch("/api/payments/moolre/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, returnPath: "/account" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start the deposit.");
        setBusy(false);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  // Manual (non-GH): the customer has paid our agent; they upload the payment
  // screenshot and we record a PENDING deposit for an admin to confirm.
  async function depositManual() {
    if (!file) {
      setError("Attach your payment screenshot to submit.");
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("Submitting your payment proof…");
    try {
      const fd = new FormData();
      fd.append("userId", user.id);
      fd.append("amount", String(amt));
      fd.append("returnPath", "/account");
      fd.append("file", file);
      const res = await fetch("/api/payments/manual/start", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not submit your deposit. Please try again.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Step 2 — submit the SMS code to complete the charge. Routes to the gateway
  // that issued the code (Flutterwave validate-charge, or Moolre direct).
  async function submitOtp() {
    if (!otpRef || !otp.trim()) return;
    const otpEndpoint =
      otpGateway === "flutterwave"
        ? "/api/payments/flutterwave/momo/otp"
        : otpGateway === "payseed"
          ? "/api/payments/payseed/otp"
          : "/api/payments/moolre/direct/otp";
    // Moolre expects `otpcode`; Flutterwave and PaySeed expect `otp`.
    const otpBody =
      otpGateway === "moolre"
        ? { reference: otpRef, otpcode: otp.trim() }
        : { reference: otpRef, otp: otp.trim() };
    setError(null);
    setBusy(true);
    setStatus("Verifying code…");
    try {
      const res = await fetch(otpEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(otpBody),
      });
      const data = await res.json();
      setDiag(data.moolre ? `Moolre: ${data.moolre.code ?? "?"} — ${data.moolre.message ?? ""}` : `status=${data.status}`);
      if (data.status === "already-credited" || data.status === "success") {
        setDone(true); onSuccess(); return;
      }
      if (data.status === "otp-invalid" || data.status === "otp") {
        setError(data.error ?? "Incorrect code. Please try again.");
        setBusy(false);
        return;
      }
      if (data.status !== "pending") {
        setError(data.error ?? "Payment could not be completed.");
        setBusy(false);
        return;
      }
      setStatus(approvalHint);
      await (otpGateway === "flutterwave"
        ? pollFlutterwaveMomo(otpRef)
        : otpGateway === "payseed"
          ? pollPayseed(otpRef)
          : pollDeposit(otpRef));
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/users/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: amt, network, phone: phone.trim() }),
      });
      const data = await res.json();
      // 202 = received & pending operator processing — still a success to the user.
      if (res.status === 202) { setDone(true); onSuccess(); return; }
      if (!res.ok) { setError(data.error ?? "Withdrawal failed."); return; }
      setDone(true);
      onSuccess();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-[420px] card rounded-b-none sm:rounded-2xl animate-rise">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
          <h3 className="font-display font-extrabold text-[16px] capitalize">{type}</h3>
          <button onClick={onClose} className="text-[var(--color-ink-faint)] hover:text-white"><X size={20} /></button>
        </div>

        {done ? (
          <div className="flex flex-col items-center text-center px-6 py-12">
            <div className="grid place-items-center w-16 h-16 rounded-full grad-emerald mb-4 shadow-[0_10px_36px_-8px_rgba(52,211,153,.6)]">
              <Check size={30} className="text-white" />
            </div>
            <h4 className="font-display font-extrabold text-[17px] capitalize">{type === "deposit" ? "Deposit submitted" : "Withdrawal requested"}</h4>
            <p className="text-[13px] text-[var(--color-ink-dim)] mt-1.5">
              {type === "deposit" ? "We've received your payment proof. Your balance is credited once we confirm it — usually within minutes." : "Funds arrive after the operator processes your request."}
            </p>
            <button onClick={onClose} className="mt-6 w-full rounded-xl py-3 font-display font-bold grad-violet-pink text-white text-sm">Done</button>
          </div>
        ) : bankAccount ? (
          <div className="p-5 space-y-4">
            <p className="text-[13px] text-[var(--color-ink-dim)]">
              Transfer exactly <span className="font-semibold text-white">{amt > 0 ? money(amt) : ""}</span> to the account below.
              Your balance updates automatically once the transfer is received.
            </p>
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] divide-y divide-[var(--color-line)]">
              {[
                { label: "Bank", value: bankAccount.bank_name ?? "—" },
                { label: "Account number", value: bankAccount.account_number ?? "—", copy: true },
                { label: "Account name", value: bankAccount.account_name ?? "—" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between px-3.5 py-3">
                  <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="num text-[14px] font-bold text-white">{row.value}</span>
                    {row.copy && row.value !== "—" && (
                      <button onClick={() => copyNumber(row.value)} className="text-[var(--color-cyan)] hover:underline text-[11px]">
                        {copiedNum === row.value ? "Copied" : "Copy"}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {status && !error && (
              <p className="text-[12.5px] text-[var(--color-cyan)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {status || "Waiting for your transfer…"}</p>
            )}
            {error && <p className="text-[12.5px] font-semibold text-[var(--color-rose,#fb7185)]">{error}</p>}
            <button
              onClick={() => { setBankAccount(null); setError(null); setStatus(""); }}
              className="w-full rounded-xl py-2.5 font-display font-semibold text-[var(--color-ink-dim)] hover:text-white text-[13px]"
            >
              ← Start over
            </button>
          </div>
        ) : redirectUrl ? (
          <div className="p-6 flex flex-col items-center text-center">
            <div className="grid place-items-center w-16 h-16 rounded-full grad-violet-pink mb-4 shadow-[0_10px_36px_-8px_rgba(139,92,246,.6)]">
              <ShieldCheck size={30} className="text-white" />
            </div>
            <h4 className="font-display font-extrabold text-[17px]">Approve your payment</h4>
            <p className="text-[13px] text-[var(--color-ink-dim)] mt-2 leading-relaxed">
              Tap continue to approve your {amt > 0 ? money(amt) : ""} Mobile Money deposit on a
              <span className="font-semibold text-white"> secure payment page</span>.
              After you approve, you&apos;ll come right back here and your balance updates automatically.
            </p>
            <button
              onClick={() => window.location.assign(redirectUrl)}
              className="mt-6 w-full rounded-xl py-3.5 font-display font-extrabold text-[14px] grad-violet-pink text-white shadow-[0_10px_30px_-8px_rgba(236,72,153,.5)] active:scale-[.99] transition"
            >
              Continue to approve
            </button>
            <button
              onClick={() => { setRedirectUrl(null); setError(null); setStatus(""); }}
              className="mt-2 w-full rounded-xl py-2.5 font-display font-semibold text-[var(--color-ink-dim)] hover:text-white text-[13px]"
            >
              Cancel
            </button>
          </div>
        ) : otpRef ? (
          <div className="p-5 space-y-4">
            <p className="text-[13px] text-[var(--color-ink-dim)]">
              Enter the verification code sent by SMS to <span className="font-semibold text-white num">{phone.trim()}</span>.
            </p>
            {network === "vod" && (
              <p className="text-[12px] text-[var(--color-amber)] bg-[var(--color-amber)]/10 border border-[var(--color-amber)]/25 rounded-lg px-3 py-2">
                Telecel Cash: after the code, <span className="font-semibold">dial *110#</span> on your phone and approve the payment — there&apos;s no pop-up prompt.
              </p>
            )}
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Verification code</label>
              <input
                type="tel"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                disabled={busy}
                placeholder="Enter code"
                className="w-full mt-2 num text-[18px] tracking-[0.3em] font-bold text-center bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3.5 py-3 outline-none focus:border-[var(--color-violet)]/60"
              />
            </div>
            {status && !error && (
              <p className="text-[12.5px] text-[var(--color-cyan)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {status}</p>
            )}
            {error && <p className="text-[12.5px] font-semibold text-[var(--color-rose,#fb7185)]">{error}</p>}
            {diag && <p className="text-[11px] text-[var(--color-amber)] break-words">{diag}</p>}
            <button
              onClick={submitOtp}
              disabled={busy || !otp.trim()}
              className="w-full rounded-xl py-3.5 font-display font-extrabold text-[14px] grad-violet-pink text-white disabled:opacity-50 active:scale-[.99] transition flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? "Verifying…" : `Confirm deposit ${amt > 0 ? money(amt) : ""}`}
            </button>
            <button
              onClick={() => { setOtpRef(null); setOtp(""); setError(null); setStatus(""); }}
              disabled={busy}
              className="w-full rounded-xl py-2.5 font-display font-semibold text-[var(--color-ink-dim)] hover:text-white text-[13px] disabled:opacity-50"
            >
              ← Start over
            </button>
          </div>
        ) : type === "withdraw" && (user.balance ?? 0) <= 0 ? (
          <div className="p-5 flex flex-col items-center text-center gap-3 py-8">
            <div className="grid place-items-center w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-line)]">
              <ArrowDownToLine size={24} className="text-[var(--color-ink-faint)]" />
            </div>
            <h4 className="font-display font-bold text-[15px]">No funds to withdraw</h4>
            <p className="text-[12.5px] text-[var(--color-ink-dim)] max-w-[280px]">
              Your balance is {money(user.balance ?? 0)}. Make a deposit first, then you can withdraw your winnings.
            </p>
            <button
              onClick={() => onSwitchToDeposit?.()}
              className="mt-1 w-full rounded-xl py-3 font-display font-extrabold text-[14px] grad-violet-pink text-white active:scale-[.99] transition"
            >
              Deposit now
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {type === "deposit" ? (
              useMomoForm ? (
              <>
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Choose network</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {NETWORKS.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setNetwork(n.id)}
                      disabled={busy}
                      className={cn("flex flex-col items-center gap-1 rounded-xl border py-3 text-[10.5px] font-semibold transition disabled:opacity-50",
                        network === n.id ? "border-[var(--color-violet)]/60 bg-[var(--color-surface-2)] text-white glow-violet" : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-2)]",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={n.logo} alt={n.name} className="w-8 h-8 rounded-md object-contain" />
                      {n.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Mobile-money number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={busy}
                  placeholder="0244 XXX XXX"
                  className="w-full mt-2 num text-[15px] bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3.5 py-3 outline-none focus:border-[var(--color-violet)]/60"
                />
                <p className="mt-2 text-[11px] text-[var(--color-ink-faint)] leading-snug">
                  You&apos;ll get a prompt on your phone to approve the payment. Your
                  balance updates automatically once it&apos;s confirmed.
                </p>
              </div>
              </>
              ) : useHostedCheckout ? (
              <div className="rounded-xl border border-[var(--color-violet)]/30 bg-[var(--color-surface-2)] px-3.5 py-3.5">
                {useMoolre && (
                  <div className="flex items-center gap-2">
                    {NETWORKS.map((n) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img key={n.id} src={n.logo} alt={n.name} className="w-8 h-8 rounded-md object-contain shrink-0" />
                    ))}
                  </div>
                )}
                <p className={cn("text-[12px] text-[var(--color-ink-dim)] leading-snug", useMoolre && "mt-2.5")}>
                  {useKorapay
                    ? "Continue to the secure checkout to pay with mobile money, card or bank transfer — your balance updates automatically once paid."
                    : "Continue to the secure page to pay with MTN MoMo, Telecel Cash or AirtelTigo Money — your balance updates automatically once paid."}
                </p>
              </div>
              ) : usePayseedBank ? (
              <div className="rounded-xl border border-[var(--color-violet)]/30 bg-[var(--color-surface-2)] px-3.5 py-3.5">
                <p className="text-[12px] text-[var(--color-ink-dim)] leading-snug">
                  Tap Deposit to get a one-time bank account. Transfer your amount to it and your
                  balance updates automatically once the payment is received.
                </p>
              </div>
              ) : (
              <div className="rounded-xl border border-[var(--color-violet)]/30 bg-[var(--color-surface-2)] px-3.5 py-3.5">
                <p className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Send your deposit to any of these</p>
                <div className="space-y-2 mt-2">
                  {accounts.map((a) => {
                    const flag = (a as { flag?: string }).flag;
                    return (
                    <div key={a.number} className="flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.logo} alt={a.network} className="w-9 h-9 rounded-md object-contain shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="num text-[17px] font-extrabold text-white tracking-wide leading-tight">{a.number}</div>
                        <div className="text-[11px] text-[var(--color-ink-dim)] truncate flex items-center gap-1.5">
                          {flag && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={flag} alt="" className="w-4 h-3 rounded-[2px] object-cover" />
                          )}
                          {a.name} · {a.network}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyNumber(a.number)}
                        className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-ink-dim)] hover:text-white transition"
                      >
                        {copiedNum === a.number ? <><Check size={13} className="text-[var(--color-emerald)]" /> Copied</> : "Copy"}
                      </button>
                    </div>
                    );
                  })}
                </div>
                <ol className="text-[11.5px] text-[var(--color-ink-dim)] leading-relaxed mt-3 list-decimal list-inside space-y-0.5">
                  <li>Send the exact amount to one of the numbers above.</li>
                  <li>Enter the amount and upload your payment screenshot below.</li>
                  <li>We confirm and credit your balance — usually within minutes.</li>
                </ol>
                <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-amber)] bg-[var(--color-amber)]/10 border border-[var(--color-amber)]/25 rounded-lg px-3 py-2">
                  ℹ️ This is our <span className="font-semibold">trusted deposit agent</span>. Send to
                  the number above and your balance is credited as soon as we confirm.
                </p>
              </div>
              )
            ) : (
              <>
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Cash out to</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {NETWORKS.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setNetwork(n.id)}
                      disabled={busy}
                      className={cn("flex flex-col items-center gap-1 rounded-xl border py-3 text-[10.5px] font-semibold transition disabled:opacity-50",
                        network === n.id ? "border-[var(--color-violet)]/60 bg-[var(--color-surface-2)] text-white glow-violet" : "border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-2)]",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={n.logo} alt={n.name} className="w-8 h-8 rounded-md object-contain" />
                      {n.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Mobile-money number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={busy}
                  placeholder="0244 XXX XXX"
                  className="w-full mt-2 num text-[15px] bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3.5 py-3 outline-none focus:border-[var(--color-violet)]/60"
                />
              </div>
              </>
            )}

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Amount</label>
              <div className="relative mt-2">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 num text-[13px] text-[var(--color-ink-faint)]">{user.currency}</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  placeholder="0.00"
                  className="w-full num text-[18px] font-bold bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl pl-16 pr-3 py-3 outline-none focus:border-[var(--color-violet)]/60"
                />
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {quick.map((q) => (
                  <button key={q} onClick={() => setAmount(String(q))} disabled={busy} className="num text-[12px] font-bold rounded-lg py-2 border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-dim)] hover:text-white transition disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
              {type === "deposit" && (
                <p className={cn("text-[11.5px] mt-2", belowMin ? "font-semibold text-[var(--color-rose,#fb7185)]" : "text-[var(--color-ink-faint)]")}>
                  Minimum deposit: <span className="num font-bold">{money(minDeposit)}</span>
                </p>
              )}
            </div>

            {type === "deposit" && !useHostedCheckout && !useFlutterwaveMomo && (
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">Payment screenshot</label>
                <label className={cn(
                  "mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-[12.5px] cursor-pointer transition",
                  file ? "border-[var(--color-emerald)]/50 text-[var(--color-emerald)] bg-[var(--color-emerald)]/8" : "border-[var(--color-line-2)] text-[var(--color-ink-dim)] hover:text-white",
                )}>
                  {file ? <><Check size={15} /> {file.name.length > 28 ? file.name.slice(0, 25) + "…" : file.name}</> : "📷 Tap to upload your payment screenshot"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                  />
                </label>
              </div>
            )}

            {type === "withdraw" && (
              <p className="text-[11.5px] text-[var(--color-ink-dim)]">Available: <span className="num font-bold text-white">{money(user.balance)}</span></p>
            )}

            {status && !error && (
              <p className="text-[12.5px] text-[var(--color-cyan)] flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> {status}
              </p>
            )}
            {error && <p className="text-[12.5px] font-semibold text-[var(--color-rose,#fb7185)]">{error}</p>}

            <button
              onClick={type === "deposit" ? deposit : withdraw}
              disabled={busy || !(amt > 0) || belowMin || (type === "deposit" && !useHostedCheckout && !useMomoForm && !usePayseedBank && !file) || (type === "deposit" && useMomoForm && !phone.trim()) || (type === "withdraw" && !phone.trim())}
              className="w-full rounded-xl py-3.5 font-display font-extrabold text-[14px] grad-violet-pink text-white disabled:opacity-50 active:scale-[.99] transition capitalize flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {type === "deposit"
                ? busy
                  ? (useHostedCheckout ? "Redirecting…" : (useMomoForm || usePayseedBank) ? "Processing…" : "Submitting…")
                  : `${useHostedCheckout || useMomoForm || usePayseedBank ? "Deposit" : "Submit deposit"} ${amt > 0 ? money(amt) : ""}`
                : `Withdraw ${amt > 0 ? money(amt) : ""}`}
            </button>

            {type === "deposit" && (
              <p className="text-center text-[11.5px] text-[var(--color-ink-dim)] mt-1">
                Payment issue?{" "}
                <a href="mailto:vefayo2163@suahi.com" className="font-semibold text-[var(--color-cyan)] hover:underline">
                  vefayo2163@suahi.com
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChangePasswordModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 6;
  const canSubmit = current.length > 0 && next.length >= 6 && next === confirm && !busy;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not change password.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative w-full sm:max-w-[420px] card rounded-b-none sm:rounded-2xl animate-rise">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-line)]">
          <h3 className="font-display font-extrabold text-[16px]">Change password</h3>
          <button onClick={onClose} disabled={busy} className="text-[var(--color-ink-faint)] hover:text-white disabled:opacity-40"><X size={20} /></button>
        </div>

        {done ? (
          <div className="flex flex-col items-center text-center px-6 py-12">
            <div className="grid place-items-center w-16 h-16 rounded-full grad-emerald mb-4 shadow-[0_10px_36px_-8px_rgba(52,211,153,.6)]">
              <Check size={30} className="text-white" />
            </div>
            <h4 className="font-display font-extrabold text-[17px]">Password updated</h4>
            <p className="text-[13px] text-[var(--color-ink-dim)] mt-1.5">Use your new password next time you sign in.</p>
            <button onClick={onClose} className="mt-6 w-full rounded-xl py-3 font-display font-bold grad-violet-pink text-white text-sm">Done</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <Field label="Current password" value={current} onChange={setCurrent} placeholder="Your current password" />
            <Field label="New password" value={next} onChange={setNext} placeholder="At least 6 characters" />
            {tooShort && <p className="text-[11.5px] text-[var(--color-rose,#fb7185)] -mt-2">New password must be at least 6 characters.</p>}
            <Field label="Confirm new password" value={confirm} onChange={setConfirm} placeholder="Re-enter new password" />
            {mismatch && <p className="text-[11.5px] text-[var(--color-rose,#fb7185)] -mt-2">Passwords don&apos;t match.</p>}

            {error && <p className="text-[12.5px] font-semibold text-[var(--color-rose,#fb7185)]">{error}</p>}

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full rounded-xl py-3.5 font-display font-extrabold text-[14px] grad-violet-pink text-white disabled:opacity-50 active:scale-[.99] transition flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Update password
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-2 text-[15px] bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl px-3.5 py-3 outline-none focus:border-[var(--color-violet)]/60 transition"
      />
    </div>
  );
}
