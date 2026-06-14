import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { useBlinkDeposit } from "@swype-org/deposit/react";
import type { SignerRequest, SignerResponse } from "@swype-org/deposit";
import { fetchBalances, API, type Balances } from "../auth/api";
import { withdrawError } from "./withdraw";
import { resolveDestination } from "../chain/resolve";
import { CHAIN_ID, USDC } from "../chain/usdc";
import { transferUsdc } from "../chain/transfer";

const env = import.meta.env as Record<string, string>;
// Optional perf hint that warms Blink's hosted flow; never trusted for auth.
const MERCHANT_ID = env.VITE_BLINK_MERCHANT_ID || undefined;
// Which Blink environment the hosted flow targets. The signed payload's
// merchantId must belong to the SAME environment (set BLINK_MERCHANT_ID to a
// sandbox id when this is 'sandbox'). Sandbox merchants auto-approve.
const BLINK_ENV: "sandbox" | "production" =
  env.VITE_BLINK_ENV === "sandbox" ? "sandbox" : "production";
const BLINK_DEBUG = env.VITE_BLINK_DEBUG === "true" || import.meta.env.DEV === true;
// Backstop so a deposit that never settles (e.g. an unapproved merchant) rejects
// with FLOW_TIMEOUT instead of spinning forever. Generous: settlement is
// backend-side, so closing the popup never loses a real deposit — the balance
// poll still catches a late completion.
const FLOW_TIMEOUT_MS = 120_000;

// Persistent in-world wallet surface: a small chip showing the player's USDC,
// which expands into a panel with their address, balances, and a Blink
// "Add funds" deposit button. Balances refresh on open and on a slow poll.
export function WalletHud({
  token,
  address,
  username,
  ensName,
}: {
  token: string;
  address: string;
  username: string;
  ensName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState<Balances | null>(null);
  const [copied, setCopied] = useState(false);
  const [amount, setAmount] = useState("10");
  // Withdraw form state, separate from the deposit "amount" above.
  const [dest, setDest] = useState("");
  const [wAmount, setWAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [wNotice, setWNotice] = useState<string | null>(null);
  const [wError, setWError] = useState(false);

  const load = useCallback(async () => {
    try {
      setBal(await fetchBalances(token));
    } catch {
      setBal({ usdc: "—", eth: "—" });
    }
  }, [token]);

  // Blink deposit. useBlinkDeposit freezes its config on first render, so the
  // signer can't close over the `token` prop (it expires). Instead it reads the
  // latest getAccessToken via a ref and fetches a fresh token at call time.
  const { getAccessToken } = usePrivy();
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  const { status, error, displayMessage, requestDeposit } = useBlinkDeposit({
    merchantId: MERCHANT_ID,
    environment: BLINK_ENV,
    enableFullWidget: false, // one-tap; no Deposit Options entry screen
    flowTimeoutMs: FLOW_TIMEOUT_MS,
    debug: BLINK_DEBUG,
    signer: async (data: SignerRequest): Promise<SignerResponse> => {
      const t = await getTokenRef.current();
      const res = await fetch(`${API}/api/sign-payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `signer failed: ${res.status}`);
      }
      return res.json();
    },
  });

  const depositing = status === "signer-loading" || status === "iframe-active";

  const addFunds = async () => {
    const amt = Number(amount);
    try {
      await requestDeposit({
        amount: Number.isFinite(amt) && amt > 0 ? amt : null,
        chainId: CHAIN_ID,
        address,
        token: USDC,
      });
      await load(); // reflect the new balance once the deposit completes
    } catch {
      // A timeout/late settlement may still land — refresh so the balance
      // reflects it if it does. Messaging is handled by `notice` below.
      void load();
    }
  };

  // Withdraw: send USDC out of the user's embedded wallet to any address. The
  // user confirms an ERC-20 transfer in a Privy modal; gas is sponsored so the
  // wallet needs no ETH (requires gas sponsorship enabled for this app on
  // mainnet — otherwise the send fails and we surface the error here).
  const { sendTransaction } = useSendTransaction();

  const balUsdc = Number(bal?.usdc);

  const withdraw = async () => {
    setWNotice(null);
    setWError(false);
    // Validate on click (not via a disabled button) so the reason an entry is
    // rejected is actually shown — a disabled button gave no feedback and looked
    // identical to an active one, so it just appeared to "do nothing".
    const invalid = withdrawError(dest, wAmount, balUsdc);
    if (invalid) {
      setWError(true);
      setWNotice(invalid);
      return;
    }

    setWithdrawing(true);
    try {
      // Accept either a 0x address or an ENS name (e.g. alice.bitopiaworld.eth);
      // resolve the name to an address on mainnet before sending.
      const to = await resolveDestination(dest);
      if (!to) {
        setWError(true);
        setWNotice("Couldn't resolve that ENS name.");
        return;
      }
      const hash = await transferUsdc(sendTransaction, to, wAmount);
      setWError(false);
      setWNotice(`Sent — tx ${short(hash)}`);
      setWAmount("");
      setDest("");
      await load(); // balance drops once mined; the open-panel poll also catches it
    } catch (e) {
      setWError(true);
      setWNotice(e instanceof Error ? e.message : "Withdrawal failed.");
    } finally {
      setWithdrawing(false);
    }
  };

  // Translate the deposit error into a panel message. A user-dismissed popup is
  // not an error; a timeout means "still settling," not "failed."
  const dismissed = error?.code === "DEPOSIT_DISMISSED";
  const timedOut = error?.code === "FLOW_TIMEOUT";
  const notice = dismissed
    ? null
    : timedOut
      ? "Still processing — your balance will update automatically if it completes."
      : displayMessage;

  // Load once up front (so the chip shows a balance), then poll only while the
  // panel is open to keep idle network traffic down.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [open, load]);

  // Prefer the ENS subdomain (e.g. alice.bitopiaworld.eth) over the raw hex; it
  // resolves to the same address, so it's also valid to copy and send to.
  const walletLabel = ensName ?? short(address);
  const copy = async () => {
    await navigator.clipboard.writeText(ensName ?? address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const usdc = fmt(bal?.usdc, 2);
  const eth = fmt(bal?.eth, 4);

  return (
    <div style={wrap}>
      {open && (
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 15 }}>{username}</strong>
            <button onClick={() => setOpen(false)} style={closeBtn} aria-label="Close">
              ×
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>Wallet</div>
          <button onClick={copy} style={addrRow} title={ensName ? "Copy ENS name" : "Copy address"}>
            <span style={{ fontFamily: "monospace" }}>{walletLabel}</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{copied ? "Copied" : "Copy"}</span>
          </button>

          <div style={balGrid}>
            <BalanceCell label="USDC" value={`$${usdc}`} />
            <BalanceCell label="ETH" value={eth} />
          </div>

          <div style={fundRow}>
            <span style={{ opacity: 0.6 }}>$</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={amountInput}
              aria-label="Amount in USD"
            />
          </div>
          <button style={fundBtn} onClick={addFunds} disabled={depositing}>
            {depositing ? "Opening Blink…" : "Add funds"}
          </button>
          {notice && <div style={timedOut ? noticeLine : errLine}>{notice}</div>}

          <div style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>Withdraw USDC</div>
          <input
            type="text"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="0x address or ENS name"
            style={destInput}
            spellCheck={false}
            aria-label="Destination address"
          />
          <div style={fundRow}>
            <span style={{ opacity: 0.6 }}>$</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={wAmount}
              onChange={(e) => setWAmount(e.target.value)}
              placeholder="0.00"
              style={amountInput}
              aria-label="Withdraw amount in USDC"
            />
          </div>
          <button
            style={withdrawing ? withdrawBtnDisabled : withdrawBtn}
            onClick={withdraw}
            disabled={withdrawing}
          >
            {withdrawing ? "Confirm in wallet…" : "Withdraw"}
          </button>
          {wNotice && <div style={wError ? errLine : noticeLine}>{wNotice}</div>}
        </div>
      )}

      <button onClick={() => setOpen((v) => !v)} style={chip}>
        <span style={{ opacity: 0.85 }}>{username}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ fontWeight: 600 }}>${usdc}</span>
      </button>
    </div>
  );
}

function BalanceCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={balCell}>
      <div style={{ fontSize: 11, opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// Format a server decimal string for display; pass through the "—" dash fallback.
function fmt(v: string | undefined, dp: number): string {
  if (v === undefined) return "…";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(dp) : v;
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

const wrap: React.CSSProperties = {
  position: "fixed",
  top: 14,
  right: 14,
  zIndex: 50,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 8,
  fontFamily: "system-ui, sans-serif",
  color: "#e8eef6",
};
const chip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid #2a3340",
  background: "#161c26",
  color: "#e8eef6",
  cursor: "pointer",
  fontSize: 14,
};
const panel: React.CSSProperties = {
  width: 260,
  padding: 16,
  borderRadius: 14,
  background: "#161c26",
  border: "1px solid #2a3340",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
};
const closeBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#9fb0c3",
  fontSize: 20,
  lineHeight: 1,
  cursor: "pointer",
};
const addrRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #2a3340",
  background: "#0c0f14",
  color: "#e8eef6",
  cursor: "pointer",
};
const balGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  marginTop: 12,
};
const balCell: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  background: "#0c0f14",
  border: "1px solid #2a3340",
};
const fundRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 14,
  padding: "8px 12px",
  borderRadius: 8,
  background: "#0c0f14",
  border: "1px solid #2a3340",
};
const amountInput: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "#e8eef6",
  fontSize: 16,
  fontWeight: 600,
};
const fundBtn: React.CSSProperties = {
  marginTop: 10,
  width: "100%",
  padding: "10px 0",
  fontSize: 14,
  border: "none",
  borderRadius: 8,
  background: "#3b82f6",
  color: "white",
  cursor: "pointer",
};
const destInput: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 8,
  background: "#0c0f14",
  border: "1px solid #2a3340",
  outline: "none",
  color: "#e8eef6",
  fontSize: 13,
  fontFamily: "monospace",
  boxSizing: "border-box",
};
const withdrawBtn: React.CSSProperties = {
  marginTop: 10,
  width: "100%",
  padding: "10px 0",
  fontSize: 14,
  border: "1px solid #2a3340",
  borderRadius: 8,
  background: "#0c0f14",
  color: "#e8eef6",
  cursor: "pointer",
};
const withdrawBtnDisabled: React.CSSProperties = {
  ...withdrawBtn,
  opacity: 0.5,
  cursor: "default",
};
const errLine: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  color: "#f87171",
};
const noticeLine: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  color: "#9fb0c3",
};
