import type { Express, Request, Response } from "express";
import express from "express";
import type { Server, Socket } from "socket.io";
import type { Database } from "better-sqlite3";
import type { SocketUser } from "shared/types";
import { avatarSeedToColor } from "shared/avatar";
import { getOrCreateUser, isUsernameTaken, setUsername, toSocketUser, type UserRow } from "./users";
import { normalizeUsername, validateUsername } from "./username";
import { verifyPrivyToken, getUserAddress } from "../chain/privy";
import { publicClient } from "../chain/clients";
import { readBalances } from "../chain/balances";
import { ensConfigured, ensureUserSubname } from "../chain/ens";
import { config } from "../config";
import { fullName } from "../chain/ensName";

function bearer(req: Request): string {
  return (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
}

// Verify a request's Privy token and ensure the user row exists. 401 on failure.
async function requireUser(req: Request, res: Response, db: Database): Promise<UserRow | null> {
  try {
    const { userId } = await verifyPrivyToken(bearer(req));
    const address = await getUserAddress(userId);
    return getOrCreateUser(db, userId, address).row;
  } catch (e: any) {
    res.status(401).json({ error: `unauthorized: ${e?.message ?? e}` });
    return null;
  }
}

export function registerAuth(io: Server, app: Express, db: Database): void {
  // Allow the Vite dev client (different origin) to call /api/* with a Bearer token.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json());

  // Socket handshake auth: verify the Privy token, load the user, expose identity.
  // A user without a claimed username may still connect (the client keeps them on
  // the onboarding screen); the world handler uses whatever identity is present.
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.privyToken as string | undefined;
      if (!token) return next(new Error("missing privy token"));
      const { userId } = await verifyPrivyToken(token);
      const address = await getUserAddress(userId);
      const { row } = getOrCreateUser(db, userId, address);
      (socket.data as { user: SocketUser }).user = toSocketUser(row);
      next();
    } catch (e: any) {
      next(new Error(`auth failed: ${e?.message ?? e}`));
    }
  });

  // Current user's claim status — drives the client's "show onboarding?" decision.
  app.get("/api/me", async (req, res) => {
    const row = await requireUser(req, res, db);
    if (!row) return;
    res.json({ id: row.id, address: row.address, username: row.username, ensName: row.ens_name });
  });

  // Current user's wallet balances (USDC + ETH) for the in-world wallet HUD.
  app.get("/api/balances", async (req, res) => {
    const row = await requireUser(req, res, db);
    if (!row) return;
    res.json(await readBalances(publicClient, row.address as `0x${string}`));
  });

  // Live availability check for the onboarding input.
  app.get("/api/username-available", async (req, res) => {
    const name = normalizeUsername(String(req.query.name ?? ""));
    const v = validateUsername(name);
    if (!v.ok) return res.json({ available: false, error: v.error });
    res.json({ available: !isUsernameTaken(db, name) });
  });

  // Claim a username: validate → DB check → on-chain ENS mint → persist.
  app.post("/api/claim-username", async (req, res) => {
    const row = await requireUser(req, res, db);
    if (!row) return;
    if (row.username) {
      return res.status(409).json({ error: "username already set" });
    }

    const name = normalizeUsername(String(req.body?.name ?? ""));
    const v = validateUsername(name);
    if (!v.ok) return res.status(400).json({ error: v.error });
    if (isUsernameTaken(db, name)) {
      return res.status(409).json({ error: "That name is taken." });
    }

    const address = row.address as `0x${string}`;
    let ensName: string;
    try {
      if (ensConfigured()) {
        const result = await ensureUserSubname(name, address, avatarSeedToColor(address));
        ensName = result.name;
      } else {
        // Dev/degraded: no parent-owner wallet configured. Store the name for
        // display without minting on-chain.
        ensName = fullName(name, config.ensParentName);
      }
    } catch (e: any) {
      // Mint reverted (likely already owned on-chain) or RPC failure.
      console.error(`[claim-username] ENS mint failed for "${name}" -> ${address}:`, e);
      return res.status(409).json({ error: "Could not register that name. Try another." });
    }

    try {
      setUsername(db, row.id, name, ensName);
    } catch (e) {
      // UNIQUE race: someone claimed it between the check and now.
      console.error(`[claim-username] setUsername failed for "${name}":`, e);
      return res.status(409).json({ error: "That name was just taken." });
    }

    res.json({ username: name, ensName });
  });
}
