import { useEffect, useState } from "react";
import { checkAvailable, claimUsername } from "../auth/api";

const PARENT = "bitopiaworld.eth";

// Onboarding step shown after login until a username is claimed. Validates and
// checks availability live, previews <name>.bitopiaworld.eth, and on submit asks
// the server to mint the ENS subname pointing at the embedded wallet.
export function UsernameGate({
  token,
  onClaimed,
}: {
  token: string;
  onClaimed: (ensName: string) => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "checking" | "ok" | "bad"; msg?: string }>({
    kind: "idle",
  });
  const [submitting, setSubmitting] = useState(false);

  const normalized = name.trim().toLowerCase();

  // Debounced availability check.
  useEffect(() => {
    if (normalized.length < 3) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "checking" });
    const t = setTimeout(async () => {
      try {
        const r = await checkAvailable(normalized);
        if (r.available) setStatus({ kind: "ok" });
        else setStatus({ kind: "bad", msg: r.error ?? "That name is taken." });
      } catch {
        setStatus({ kind: "bad", msg: "Couldn't check availability." });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [normalized]);

  const canSubmit = status.kind === "ok" && !submitting;

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await claimUsername(token, normalized);
      if (r.error || !r.ensName) {
        setStatus({ kind: "bad", msg: r.error ?? "Could not claim that name." });
        return;
      }
      onClaimed(r.ensName);
    } catch {
      setStatus({ kind: "bad", msg: "Network error. Try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={card}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Choose your name</h1>
        <p style={{ opacity: 0.7, marginTop: 6, fontSize: 14 }}>
          This becomes your identity in bitopia — an ENS name pointing at your wallet.
        </p>

        <div style={{ display: "flex", alignItems: "baseline", marginTop: 18 }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
            placeholder="yourname"
            style={input}
          />
          <span style={{ opacity: 0.6, marginLeft: 6 }}>.{PARENT}</span>
        </div>

        <div style={{ minHeight: 20, marginTop: 8, fontSize: 13 }}>
          {status.kind === "checking" && <span style={{ opacity: 0.6 }}>Checking…</span>}
          {status.kind === "ok" && <span style={{ color: "#6ee7a8" }}>✓ {normalized}.{PARENT} is available</span>}
          {status.kind === "bad" && <span style={{ color: "#f78c8c" }}>{status.msg}</span>}
        </div>

        <button onClick={submit} disabled={!canSubmit} style={{ ...button, opacity: canSubmit ? 1 : 0.5 }}>
          {submitting ? "Registering…" : "Claim name & enter"}
        </button>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "#0c0f14",
  color: "#e8eef6",
  fontFamily: "system-ui, sans-serif",
};
const card: React.CSSProperties = { width: 360, padding: 28, background: "#161c26", borderRadius: 14 };
const input: React.CSSProperties = {
  flex: 1,
  fontSize: 18,
  padding: "8px 10px",
  background: "#0c0f14",
  color: "#e8eef6",
  border: "1px solid #2a3340",
  borderRadius: 8,
};
const button: React.CSSProperties = {
  marginTop: 18,
  width: "100%",
  padding: "10px 0",
  fontSize: 15,
  border: "none",
  borderRadius: 8,
  background: "#3b82f6",
  color: "white",
  cursor: "pointer",
};
