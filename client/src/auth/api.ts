// Thin client for the server's identity endpoints. The caller supplies the Privy
// access token (from usePrivy().getAccessToken()).

// Empty/unset VITE_SOCKET_URL means "same origin" (single-service Railway deploy):
// fetches hit relative /api/* paths. Local dev sets it to http://localhost:8787.
export const API = (import.meta.env as Record<string, string>).VITE_SOCKET_URL || "";

export interface Me {
  id: string;
  address: string;
  username: string | null;
  ensName: string | null;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function fetchMe(token: string): Promise<Me> {
  const res = await fetch(`${API}/api/me`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  return res.json();
}

export interface Balances {
  usdc: string;
  eth: string;
}

export async function fetchBalances(token: string): Promise<Balances> {
  const res = await fetch(`${API}/api/balances`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`balances failed: ${res.status}`);
  return res.json();
}

export async function checkAvailable(name: string): Promise<{ available: boolean; error?: string }> {
  const res = await fetch(`${API}/api/username-available?name=${encodeURIComponent(name)}`);
  return res.json();
}

export async function claimUsername(
  token: string,
  name: string
): Promise<{ username?: string; ensName?: string; error?: string }> {
  const res = await fetch(`${API}/api/claim-username`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  return res.json();
}
