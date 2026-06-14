import { useCallback, useEffect, useState } from "react";
import { fetchBalances, type Balances } from "../auth/api";

// Persistent in-world wallet surface: a small chip showing the player's USDC,
// which expands into a panel with their address, balances, and a (stubbed)
// Blink "Add funds" button. Balances refresh on open and on a slow poll.
export function WalletHud({
  token,
  address,
  username,
}: {
  token: string;
  address: string;
  username: string;
}) {
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState<Balances | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setBal(await fetchBalances(token));
    } catch {
      setBal({ usdc: "—", eth: "—" });
    }
  }, [token]);

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

  const copy = async () => {
    await navigator.clipboard.writeText(address);
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
          <button onClick={copy} style={addrRow} title="Copy address">
            <span style={{ fontFamily: "monospace" }}>{short(address)}</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{copied ? "Copied" : "Copy"}</span>
          </button>

          <div style={balGrid}>
            <BalanceCell label="USDC" value={`$${usdc}`} />
            <BalanceCell label="ETH" value={eth} />
          </div>

          <button style={fundBtn} disabled title="Coming soon">
            Add funds
          </button>
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
const fundBtn: React.CSSProperties = {
  marginTop: 14,
  width: "100%",
  padding: "10px 0",
  fontSize: 14,
  border: "none",
  borderRadius: 8,
  background: "#3b82f6",
  color: "white",
  cursor: "not-allowed",
  opacity: 0.5,
};
