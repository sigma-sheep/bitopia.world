import { useCallback, useEffect, useState } from "react";
import { usePrivy, useGuestAccounts } from "@privy-io/react-auth";
import { AppPrivyProvider } from "./auth/PrivyProvider";
import { fetchMe, type Me } from "./auth/api";
import { UsernameGate } from "./ui/UsernameGate";
import { WalletHud } from "./ui/WalletHud";
import { WorldCanvas } from "./render/WorldCanvas";

export default function App() {
  return (
    <AppPrivyProvider>
      <Gate />
    </AppPrivyProvider>
  );
}

// Decides what to show: login → (wallet setup) → choose-username → the world.
function Gate() {
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const { createGuestAccount } = useGuestAccounts();
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = loading

  const loadMe = useCallback(async () => {
    const t = await getAccessToken();
    if (!t) return;
    setToken(t);
    try {
      setMe(await fetchMe(t));
    } catch {
      setMe(null);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!authenticated) {
      setToken(null);
      setMe(undefined);
      return;
    }
    // Wait for the embedded wallet to provision before hitting the server: the
    // backend resolves identity from the wallet address and 401s without one.
    // Matters for guests, whose wallet is created async right after login.
    if (!user?.wallet?.address) return;
    void loadMe();
  }, [authenticated, user?.wallet?.address, loadMe]);

  if (!ready) return <Splash text="Loading…" />;
  if (!authenticated) return <Login onLogin={login} onGuest={createGuestAccount} />;
  if (me === undefined || !token) return <Splash text="Setting up your wallet…" />;
  if (me === null) return <Splash text="Couldn't reach the server. Retry shortly." />;
  if (!me.username) return <UsernameGate token={token} onClaimed={() => void loadMe()} />;

  return (
    <>
      <WorldCanvas token={token} />
      <WalletHud token={token} address={me.address} username={me.username} />
    </>
  );
}

function Login({ onLogin, onGuest }: { onLogin: () => void; onGuest: () => void }) {
  return (
    <div style={overlay}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 30, margin: 0 }}>bitopia.world</h1>
        <p style={{ opacity: 0.7, marginTop: 8 }}>An isometric world for humans and AI agents.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <button onClick={onLogin} style={button}>Log in</button>
          <button onClick={onGuest} style={guestButton}>Continue as guest</button>
        </div>
      </div>
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div style={overlay}>
      <div style={{ opacity: 0.8 }}>{text}</div>
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
const button: React.CSSProperties = {
  marginTop: 22,
  padding: "11px 26px",
  fontSize: 16,
  border: "none",
  borderRadius: 10,
  background: "#3b82f6",
  color: "white",
  cursor: "pointer",
};
const guestButton: React.CSSProperties = {
  padding: "9px 22px",
  fontSize: 14,
  border: "1px solid #2a3340",
  borderRadius: 10,
  background: "transparent",
  color: "#9fb0c3",
  cursor: "pointer",
};
