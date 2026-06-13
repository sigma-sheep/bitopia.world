import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getOrCreateUser, isUsernameTaken, setUsername, toSocketUser } from "./users";

const here = dirname(fileURLToPath(import.meta.url));
function freshDb() {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(here, "../db/schema.sql"), "utf8"));
  return db;
}

describe("getOrCreateUser", () => {
  it("creates a user row on first sight and is idempotent", () => {
    const db = freshDb();
    const a = getOrCreateUser(db, "privy1", "0xabc");
    expect(a.created).toBe(true);
    expect(a.row.id).toBe("privy1");
    expect(a.row.address).toBe("0xabc");
    expect(a.row.username).toBeNull();

    const b = getOrCreateUser(db, "privy1", "0xabc");
    expect(b.created).toBe(false);
    expect(b.row.id).toBe("privy1");
  });
});

describe("isUsernameTaken", () => {
  it("is false before a claim and true after", () => {
    const db = freshDb();
    getOrCreateUser(db, "privy1", "0xabc");
    expect(isUsernameTaken(db, "alice")).toBe(false);
    setUsername(db, "privy1", "alice", "alice.bitopiaworld.eth");
    expect(isUsernameTaken(db, "alice")).toBe(true);
  });
});

describe("setUsername", () => {
  it("stores username + ens_name on the row", () => {
    const db = freshDb();
    getOrCreateUser(db, "privy1", "0xabc");
    setUsername(db, "privy1", "alice", "alice.bitopiaworld.eth");
    const { row } = getOrCreateUser(db, "privy1", "0xabc");
    expect(row.username).toBe("alice");
    expect(row.ens_name).toBe("alice.bitopiaworld.eth");
  });

  it("throws when a different user already holds the name", () => {
    const db = freshDb();
    getOrCreateUser(db, "privy1", "0xa");
    getOrCreateUser(db, "privy2", "0xb");
    setUsername(db, "privy1", "alice", "alice.bitopiaworld.eth");
    expect(() => setUsername(db, "privy2", "alice", "alice.bitopiaworld.eth")).toThrow();
  });
});

describe("toSocketUser", () => {
  it("maps a row to the SocketUser shape, preferring ens_name as display", () => {
    const db = freshDb();
    getOrCreateUser(db, "privy1", "0xabcabc");
    setUsername(db, "privy1", "alice", "alice.bitopiaworld.eth");
    const { row } = getOrCreateUser(db, "privy1", "0xabcabc");
    expect(toSocketUser(row)).toEqual({
      id: "privy1",
      address: "0xabcabc",
      ensName: "alice.bitopiaworld.eth",
      avatarSeed: "0xabcabc",
      roomId: "lobby",
    });
  });
});
