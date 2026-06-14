import type { Database } from "better-sqlite3";
import type { SocketUser } from "shared/types";

export interface UserRow {
  id: string;
  address: string;
  username: string | null;
  ens_name: string | null;
  avatar_seed: string;
  room_id: string;
  created_at: number;
}

// Everyone shares the lobby for now; per-user rooms are a later concern.
const LOBBY_ROOM_ID = "lobby";

export interface ProvisionResult {
  row: UserRow;
  created: boolean;
}

// Creates the users row on first sight (no username yet); idempotent thereafter.
export function getOrCreateUser(db: Database, privyUserId: string, address: string): ProvisionResult {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(privyUserId) as UserRow | undefined;
  if (existing) return { row: existing, created: false };

  db.prepare(
    "INSERT INTO users (id, address, avatar_seed, room_id, created_at) VALUES (?,?,?,?,?)"
  ).run(privyUserId, address, address, LOBBY_ROOM_ID, Date.now());

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(privyUserId) as UserRow;
  return { row, created: true };
}

export function isUsernameTaken(db: Database, username: string): boolean {
  const hit = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
  return hit !== undefined;
}

// Persists the chosen handle + issued ENS name. Throws (UNIQUE constraint) if the
// username was claimed by someone else between the availability check and here.
export function setUsername(db: Database, privyUserId: string, username: string, ensName: string): void {
  db.prepare("UPDATE users SET username = ?, ens_name = ? WHERE id = ?").run(username, ensName, privyUserId);
}

export function toSocketUser(row: UserRow): SocketUser {
  return {
    id: row.id,
    address: row.address,
    ensName: row.ens_name ?? undefined,
    avatarSeed: row.avatar_seed,
    roomId: row.room_id,
  };
}
