import { useEffect, useState } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import { fetchBalances } from "../auth/api";
import { withdrawError } from "./withdraw";
import { transferUsdc } from "../chain/transfer";

// Who was clicked and where (viewport pixels) so the menu can anchor to the
// cursor. Reported by WorldCanvas; consumed here.
export interface TransferTarget {
  id: string;
  displayName: string;
  address: string;
  ensName: string | null;
  x: number;
  y: number;
}

const ENS_PARENT_SUFFIX = ".bitopiaworld.eth";

// Prefer the ENS subname, shown without the shared suffix (alice instead of
// alice.bitopiaworld.eth); fall back to the short-address displayName.
function label(target: TransferTarget): string {
  const name = target.ensName ?? target.displayName;
  return name.endsWith(ENS_PARENT_SUFFIX) ? name.slice(0, -ENS_PARENT_SUFFIX.length) : name;
}

function short(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

// Context menu + transfer popup for a clicked player. Opens as a small menu at
// the cursor; "Transfer" swaps it for a centered amount popup that signs a real
// USDC transfer (Privy modal, gas sponsored) to the target's wallet.
export function PlayerMenu({
  target,
  token,
  onClose,
}: {
  target: TransferTarget;
  token: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "transfer">("menu");
  const [amount, setAmount] = useState("");
  const [balUsdc, setBalUsdc] = useState<number>(NaN);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const { sendTransaction } = useSendTransaction();

  // Close on Escape, matching the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the sender's USDC balance once the popup opens, for validation.
  useEffect(() => {
    if (mode !== "transfer") return;
    let alive = true;
    void fetchBalances(token)
      .then((b) => alive && setBalUsdc(Number(b.usdc)))
      .catch(() => alive && setBalUsdc(NaN));
    return () => {
      alive = false;
    };
  }, [mode, token]);

  const send = async () => {
    setNotice(null);
    setError(false);
    const invalid = withdrawError(target.address, amount, balUsdc);
    if (invalid) {
      setError(true);
      setNotice(invalid);
      return;
    }
    setSending(true);
    try {
      const hash = await transferUsdc(sendTransaction, target.address as `0x${string}`, amount);
      setError(false);
      setNotice(`Sent — tx ${short(hash)}`);
      setAmount("");
    } catch (e) {
      setError(true);
      setNotice(e instanceof Error ? e.message : "Transfer failed.");
    } finally {
      setSending(false);
    }
  };

  // Keep the menu on-screen even when clicked near the right/bottom edge.
  const left = Math.min(target.x, window.innerWidth - 180);
  const top = Math.min(target.y, window.innerHeight - 120);

  return (
    <div style={backdrop} onClick={onClose}>
      {mode === "menu" ? (
        <div style={{ ...menu, left, top }} onClick={(e) => e.stopPropagation()}>
          <div style={menuName}>{label(target)}</div>
          <button style={menuItem} onClick={() => setMode("transfer")}>
            Transfer USDC
          </button>
        </div>
      ) : (
        <div style={popup} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 15 }}>Transfer to {label(target)}</strong>
            <button onClick={onClose} style={closeBtn} aria-label="Close">
              ×
            </button>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.6, fontFamily: "monospace" }}>
            {target.ensName ?? short(target.address)}
          </div>

          <div style={fundRow}>
            <span style={{ opacity: 0.6 }}>$</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={amountInput}
              aria-label="Amount in USDC"
              autoFocus
            />
          </div>

          <button style={sending ? sendBtnDisabled : sendBtn} onClick={send} disabled={sending}>
            {sending ? "Confirm in wallet…" : "Send"}
          </button>
          {notice && <div style={error ? errLine : noticeLine}>{notice}</div>}
        </div>
      )}
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  fontFamily: "system-ui, sans-serif",
  color: "#e8eef6",
};
const menu: React.CSSProperties = {
  position: "absolute",
  width: 160,
  padding: 6,
  borderRadius: 10,
  background: "#161c26",
  border: "1px solid #2a3340",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
};
const menuName: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 12,
  opacity: 0.6,
  borderBottom: "1px solid #2a3340",
  marginBottom: 4,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const menuItem: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  textAlign: "left",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "#e8eef6",
  cursor: "pointer",
  fontSize: 14,
};
const popup: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
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
const sendBtn: React.CSSProperties = {
  marginTop: 12,
  width: "100%",
  padding: "10px 0",
  fontSize: 14,
  border: "none",
  borderRadius: 8,
  background: "#3b82f6",
  color: "white",
  cursor: "pointer",
};
const sendBtnDisabled: React.CSSProperties = {
  ...sendBtn,
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
