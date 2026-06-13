# S2 Realtime + Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`. Read `2026-06-13-bitopia-00-overview.md` first — Seams are frozen. Work in the `s2-realtime` git worktree (off the S0 commit).

**Goal:** Build the live multiplayer game — an authoritative in-memory world server (rooms, presence, movement, chat) wired over socket.io, and a Three.js isometric client that renders rooms, avatars with ENS nameplates, click-to-move/WASD movement, chat, and a room switcher. No blockchain in this stream. The stream runs standalone via a dev-mode identity fallback (so two browser windows can be tested before S3 auth lands) and binds exactly to the frozen `Entity`/`protocol`/`WorldApi`/`socket.data.user` seams.

**Architecture:** Logic lives in pure, unit-tested modules (`state.ts`, `iso.ts`, `entityStore.ts`); side-effecting layers (socket broadcasting, Three.js rendering) are thin shells over them. The server's `registerWorld(io, db)` implements and assigns the exported `worldApi` singleton (the cross-module seam S3/S4 consume) and wires the socket connection lifecycle. The client connects via `connectSocket()`, feeds socket events through the `entityStore` reducer, and drives the Three.js scene from the resulting entity map.

**Tech Stack:** TypeScript, socket.io, Three.js, React, Vitest.

---

### Task 1: Pure world state (`state.ts`)

The authoritative in-memory model: `Map<roomId, Map<entityId, Entity>>`. No socket, no db — pure and fully unit-tested. Everything else builds on it.

**Files:**
- Create: `server/src/world/state.ts`
- Create: `server/src/world/state.test.ts`

- [ ] **Step 1: Write the failing test `server/src/world/state.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { WorldState } from "./state.js";
import type { Entity } from "shared/types";

function ent(id: string, roomId: string, x = 1, y = 1): Entity {
  return {
    id,
    type: "player",
    roomId,
    pos: { x, y },
    facing: "S",
    displayName: id,
    avatarSeed: "0x" + id,
  };
}

describe("WorldState", () => {
  it("adds an entity and lists it in its room", () => {
    const w = new WorldState();
    w.addEntity(ent("a", "r1"));
    expect(w.roomEntities("r1").map((e) => e.id)).toEqual(["a"]);
  });

  it("returns an empty array for an unknown room", () => {
    const w = new WorldState();
    expect(w.roomEntities("nope")).toEqual([]);
  });

  it("getEntity returns the entity regardless of room", () => {
    const w = new WorldState();
    w.addEntity(ent("a", "r1"));
    expect(w.getEntity("a")?.id).toBe("a");
    expect(w.getEntity("missing")).toBeUndefined();
  });

  it("moveEntity updates pos and facing in place", () => {
    const w = new WorldState();
    w.addEntity(ent("a", "r1", 0, 0));
    w.moveEntity("a", { x: 5, y: 6 }, "E");
    const e = w.getEntity("a")!;
    expect(e.pos).toEqual({ x: 5, y: 6 });
    expect(e.facing).toBe("E");
  });

  it("moveEntity on a missing id is a no-op (no throw)", () => {
    const w = new WorldState();
    expect(() => w.moveEntity("ghost", { x: 1, y: 1 }, "N")).not.toThrow();
  });

  it("removeEntity deletes from its room", () => {
    const w = new WorldState();
    w.addEntity(ent("a", "r1"));
    w.addEntity(ent("b", "r1"));
    w.removeEntity("a");
    expect(w.roomEntities("r1").map((e) => e.id)).toEqual(["b"]);
    expect(w.getEntity("a")).toBeUndefined();
  });

  it("setRoom moves an entity between rooms and updates roomId", () => {
    const w = new WorldState();
    w.addEntity(ent("a", "r1"));
    w.setRoom("a", "r2", { x: 2, y: 3 });
    expect(w.roomEntities("r1")).toEqual([]);
    expect(w.roomEntities("r2").map((e) => e.id)).toEqual(["a"]);
    const e = w.getEntity("a")!;
    expect(e.roomId).toBe("r2");
    expect(e.pos).toEqual({ x: 2, y: 3 });
  });

  it("setRoom on a missing id is a no-op", () => {
    const w = new WorldState();
    expect(() => w.setRoom("ghost", "r2", { x: 0, y: 0 })).not.toThrow();
  });

  it("roomEntities returns copies-by-reference but isolates rooms", () => {
    const w = new WorldState();
    w.addEntity(ent("a", "r1"));
    w.addEntity(ent("b", "r2"));
    expect(w.roomEntities("r1").map((e) => e.id)).toEqual(["a"]);
    expect(w.roomEntities("r2").map((e) => e.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `npm test -w server -- state`
Expected: FAIL — `Cannot find module './state.js'` (or `WorldState is not a constructor`).

- [ ] **Step 3: Implement `server/src/world/state.ts`**

```ts
import type { Entity, Vec2, Facing } from "shared/types";

/**
 * Pure in-memory authoritative world model.
 * Map<roomId, Map<entityId, Entity>> plus an id->roomId index for O(1) lookup.
 * No I/O, no broadcasting — the socket layer wraps this.
 */
export class WorldState {
  private rooms = new Map<string, Map<string, Entity>>();
  private entityRoom = new Map<string, string>();

  private roomMap(roomId: string): Map<string, Entity> {
    let m = this.rooms.get(roomId);
    if (!m) {
      m = new Map();
      this.rooms.set(roomId, m);
    }
    return m;
  }

  addEntity(e: Entity): void {
    this.roomMap(e.roomId).set(e.id, e);
    this.entityRoom.set(e.id, e.roomId);
  }

  getEntity(id: string): Entity | undefined {
    const roomId = this.entityRoom.get(id);
    if (!roomId) return undefined;
    return this.rooms.get(roomId)?.get(id);
  }

  moveEntity(id: string, pos: Vec2, facing: Facing): void {
    const e = this.getEntity(id);
    if (!e) return;
    e.pos = pos;
    e.facing = facing;
  }

  removeEntity(id: string): void {
    const roomId = this.entityRoom.get(id);
    if (!roomId) return;
    this.rooms.get(roomId)?.delete(id);
    this.entityRoom.delete(id);
  }

  setRoom(id: string, roomId: string, pos: Vec2): void {
    const e = this.getEntity(id);
    if (!e) return;
    const oldRoomId = this.entityRoom.get(id)!;
    this.rooms.get(oldRoomId)?.delete(id);
    e.roomId = roomId;
    e.pos = pos;
    this.roomMap(roomId).set(id, e);
    this.entityRoom.set(id, roomId);
  }

  roomEntities(roomId: string): Entity[] {
    const m = this.rooms.get(roomId);
    return m ? [...m.values()] : [];
  }
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w server -- state`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/world/state.ts server/src/world/state.test.ts
git commit -m "feat(world): pure in-memory WorldState with unit tests"
```

---

### Task 2: Rooms loader + dev seeding (`rooms.ts`)

Read the `rooms` table; if empty (dev mode, no S3 auth seeding users/rooms yet), seed 2 demo rooms so two windows can be tested standalone.

**Files:**
- Create: `server/src/world/rooms.ts`
- Create: `server/src/world/rooms.test.ts`

- [ ] **Step 1: Write the failing test `server/src/world/rooms.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRooms } from "./rooms.js";

const here = dirname(fileURLToPath(import.meta.url));

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(here, "../db/schema.sql"), "utf8"));
  return db;
}

describe("loadRooms", () => {
  it("seeds 2 demo rooms when the table is empty", () => {
    const db = freshDb();
    const rooms = loadRooms(db);
    expect(rooms).toHaveLength(2);
    for (const r of rooms) {
      expect(typeof r.id).toBe("string");
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
    // persisted, so a re-read returns the same rooms (not re-seeded)
    const again = loadRooms(db);
    expect(again).toHaveLength(2);
    expect(again.map((r) => r.id).sort()).toEqual(rooms.map((r) => r.id).sort());
  });

  it("reads existing rooms without seeding", () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO rooms (id, owner_user_id, ens_name, width, height, created_at) VALUES (?,?,?,?,?,?)"
    ).run("custom", "owner1", "owner1-room.bitopiaworld.eth", 20, 24, Date.now());
    const rooms = loadRooms(db);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      id: "custom",
      ownerUserId: "owner1",
      ensName: "owner1-room.bitopiaworld.eth",
      width: 20,
      height: 24,
    });
  });

  it("maps null ens_name to undefined", () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO rooms (id, owner_user_id, ens_name, width, height, created_at) VALUES (?,?,?,?,?,?)"
    ).run("r", "o", null, 30, 30, Date.now());
    const rooms = loadRooms(db);
    expect(rooms[0].ensName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `npm test -w server -- rooms`
Expected: FAIL — `Cannot find module './rooms.js'`.

- [ ] **Step 3: Implement `server/src/world/rooms.ts`**

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Room } from "shared/types";

interface RoomRow {
  id: string;
  owner_user_id: string;
  ens_name: string | null;
  width: number;
  height: number;
}

function rowToRoom(r: RoomRow): Room {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    ensName: r.ens_name ?? undefined,
    width: r.width,
    height: r.height,
  };
}

function selectAll(db: Database.Database): Room[] {
  const rows = db
    .prepare(
      "SELECT id, owner_user_id, ens_name, width, height FROM rooms ORDER BY created_at ASC"
    )
    .all() as RoomRow[];
  return rows.map(rowToRoom);
}

/**
 * Load rooms from the DB. In dev mode (table empty, S3 not yet seeding rooms)
 * seed two demo rooms so two browser windows can be tested standalone.
 */
export function loadRooms(db: Database.Database): Room[] {
  const existing = selectAll(db);
  if (existing.length > 0) return existing;

  const insert = db.prepare(
    "INSERT INTO rooms (id, owner_user_id, ens_name, width, height, created_at) VALUES (?,?,?,?,?,?)"
  );
  const now = Date.now();
  const demos = [
    { ens: "demo-one-room.bitopiaworld.eth" },
    { ens: "demo-two-room.bitopiaworld.eth" },
  ];
  for (const d of demos) {
    insert.run(randomUUID(), "dev", d.ens, 30, 30, now);
  }
  return selectAll(db);
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w server -- rooms`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/world/rooms.ts server/src/world/rooms.test.ts
git commit -m "feat(world): rooms loader with dev demo-room seeding"
```

---

### Task 3: World server wiring + WorldApi singleton (`index.ts`)

Implements `registerWorld(io, db)`: assigns the exported `worldApi` singleton (the frozen cross-module seam) and wires the socket lifecycle (connect/spawn/welcome, enterRoom, move, chat, disconnect). Reads `socket.data.user` set by S3 auth, or falls back to a generated dev identity so S2 runs standalone.

**Files:**
- Create: `server/src/world/index.ts`
- Modify: `server/src/index.ts` (one import + one call line — predictable merge point)

- [ ] **Step 1: Implement `server/src/world/index.ts`**

```ts
import type { Server, Socket } from "socket.io";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import "../socketTypes.js";
import type {
  Entity,
  Vec2,
  Facing,
  ChatMessage,
  TxRecord,
  Room,
  SocketUser,
} from "shared/types";
import type { ClientToServer, ServerToClient } from "shared/protocol";
import { avatarSeedToColor } from "shared/avatar";
import { WorldState } from "./state.js";
import { loadRooms } from "./rooms.js";

// ---- Frozen WorldApi seam (overview "Cross-module server APIs") ----
export interface WorldApi {
  addEntity(e: Entity): void;
  moveEntity(id: string, pos: Vec2, facing: Facing): void;
  removeEntity(id: string): void;
  roomEntities(roomId: string): Entity[];
  emitChat(msg: ChatMessage): void;
  emitTx(rec: TxRecord, toRoomId?: string): void;
}
export let worldApi: WorldApi; // assigned during registerWorld(io, db)

type IO = Server<ClientToServer, ServerToClient>;
type AppSocket = Socket<ClientToServer, ServerToClient>;

const SPAWN: Vec2 = { x: 15, y: 15 };

function clampToRoom(pos: Vec2, room: Room | undefined): Vec2 {
  const w = room?.width ?? 30;
  const h = room?.height ?? 30;
  return {
    x: Math.max(0, Math.min(w - 1, Math.round(pos.x))),
    y: Math.max(0, Math.min(h - 1, Math.round(pos.y))),
  };
}

/** Dev-mode identity used when S3 auth middleware has not set socket.data.user. */
function devIdentity(rooms: Room[]): SocketUser {
  const id = "dev-" + randomUUID().slice(0, 8);
  const roomId = rooms[0]?.id ?? "dev-room";
  return { id, address: id, avatarSeed: id, roomId };
}

function persistMessage(db: Database.Database, msg: ChatMessage): void {
  db.prepare(
    "INSERT INTO messages (id, room_id, sender_id, sender_name, text, ts) VALUES (?,?,?,?,?,?)"
  ).run(msg.id, msg.roomId, msg.senderId, msg.senderName, msg.text, msg.ts);
}

export function registerWorld(io: IO, db: Database.Database): void {
  const world = new WorldState();
  let rooms = loadRooms(db);
  const roomById = (id: string) => rooms.find((r) => r.id === id);

  // Assign the singleton so S3/S4 can drive the world after boot.
  worldApi = {
    addEntity(e: Entity) {
      world.addEntity(e);
      io.to(e.roomId).emit("entityJoined", { entity: e });
    },
    moveEntity(id: string, pos: Vec2, facing: Facing) {
      world.moveEntity(id, pos, facing);
      const e = world.getEntity(id);
      if (!e) return;
      io.to(e.roomId).emit("entityMoved", { id, pos: e.pos, facing: e.facing });
    },
    removeEntity(id: string) {
      const e = world.getEntity(id);
      if (!e) return;
      const roomId = e.roomId;
      world.removeEntity(id);
      io.to(roomId).emit("entityLeft", { id });
    },
    roomEntities(roomId: string) {
      return world.roomEntities(roomId);
    },
    emitChat(msg: ChatMessage) {
      persistMessage(db, msg);
      io.to(msg.roomId).emit("chat", { message: msg });
    },
    emitTx(rec: TxRecord, toRoomId?: string) {
      if (toRoomId) io.to(toRoomId).emit("tx", { record: rec });
      else io.emit("tx", { record: rec });
    },
  };

  io.on("connection", (socket: AppSocket) => {
    const user: SocketUser = socket.data.user ?? devIdentity(rooms);
    const startRoom = roomById(user.roomId) ?? rooms[0];
    const roomId = startRoom?.id ?? user.roomId;

    const self: Entity = {
      id: user.id,
      type: "player",
      roomId,
      pos: clampToRoom(SPAWN, startRoom),
      facing: "S",
      displayName: user.ensName ?? user.address,
      ensName: user.ensName,
      avatarSeed: user.avatarSeed,
    };

    socket.join(roomId);
    world.addEntity(self);

    socket.emit("welcome", { selfId: self.id, rooms });
    socket.emit("roomState", { roomId, entities: world.roomEntities(roomId) });
    // Tell others in the room about the newcomer (not the newcomer itself).
    socket.to(roomId).emit("entityJoined", { entity: self });

    socket.on("enterRoom", (p: { roomId: string }) => {
      const target = roomById(p.roomId);
      if (!target) return;
      const e = world.getEntity(self.id);
      if (!e) return;
      const oldRoomId = e.roomId;
      if (oldRoomId === target.id) return;

      socket.leave(oldRoomId);
      io.to(oldRoomId).emit("entityLeft", { id: self.id });

      const pos = clampToRoom(SPAWN, target);
      world.setRoom(self.id, target.id, pos);
      socket.join(target.id);

      const moved = world.getEntity(self.id)!;
      socket.emit("roomState", {
        roomId: target.id,
        entities: world.roomEntities(target.id),
      });
      socket.to(target.id).emit("entityJoined", { entity: moved });
    });

    socket.on("move", (p: { pos: Vec2; facing: Facing }) => {
      const e = world.getEntity(self.id);
      if (!e) return;
      const pos = clampToRoom(p.pos, roomById(e.roomId));
      world.moveEntity(self.id, pos, p.facing);
      io.to(e.roomId).emit("entityMoved", { id: self.id, pos, facing: p.facing });
    });

    socket.on("chat", (p: { text: string }) => {
      const e = world.getEntity(self.id);
      if (!e) return;
      const text = (p.text ?? "").toString().slice(0, 500);
      if (!text.trim()) return;
      const msg: ChatMessage = {
        id: randomUUID(),
        roomId: e.roomId,
        senderId: self.id,
        senderName: self.displayName,
        text,
        ts: Date.now(),
      };
      persistMessage(db, msg);
      io.to(e.roomId).emit("chat", { message: msg });
    });

    socket.on("disconnect", () => {
      const e = world.getEntity(self.id);
      if (!e) return;
      const r = e.roomId;
      world.removeEntity(self.id);
      io.to(r).emit("entityLeft", { id: self.id });
    });
  });

  // Touch avatarSeedToColor import so it is not tree-shaken in builds that
  // depend on it for parity with the client (no behavior; safe no-op).
  void avatarSeedToColor;
}
```

- [ ] **Step 2: Wire it into the composition root `server/src/index.ts`** — add one import and replace the `// registerWorld(io, db);` stub comment with a real call.

Add near the other imports:

```ts
import { registerWorld } from "./world/index.js";
```

Replace the line:

```ts
// registerWorld(io, db);      // S2
```

with:

```ts
registerWorld(io, db);      // S2
```

- [ ] **Step 3: Type-check the server**

Run: `npm run -w server exec tsc --noEmit`
Expected: no type errors. (If `server` has no `exec` typecheck script, run `npx -w server tsc --noEmit` from repo root.)

- [ ] **Step 4: Commit**

```bash
git add server/src/world/index.ts server/src/index.ts
git commit -m "feat(world): registerWorld + WorldApi singleton + socket lifecycle"
```

---

### Task 4: World integration test (2 socket.io-client connections)

Spin an ephemeral socket.io server with an in-memory DB and connect 2 real `socket.io-client` sockets. Verify move broadcasts to the other client, chat broadcasts, and `enterRoom` switching (leave/join semantics). Dev-identity fallback is exercised because no auth middleware is installed.

**Files:**
- Create: `server/src/world/integration.test.ts`
- Modify: `server/package.json` (add `socket.io-client` devDependency)

- [ ] **Step 1: Add `socket.io-client` as a server devDependency**

In `server/package.json`, add to `devDependencies`:

```json
"socket.io-client": "^4.7.0"
```

Then install:

Run: `npm install`
Expected: installs `socket.io-client` into the workspace.

- [ ] **Step 2: Write the failing integration test `server/src/world/integration.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerWorld } from "./index.js";
import type { Room, Entity, ChatMessage, Vec2, Facing } from "shared/types";

const here = dirname(fileURLToPath(import.meta.url));

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(here, "../db/schema.sql"), "utf8"));
  return db;
}

function once<T>(sock: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}"`)),
      2000
    );
    sock.once(event, (p: T) => {
      clearTimeout(timer);
      resolve(p);
    });
  });
}

let http: HttpServer;
let ioServer: Server;
let port: number;
let rooms: Room[];

beforeEach(async () => {
  http = createServer();
  ioServer = new Server(http, { cors: { origin: "*" } });
  const db = freshDb();
  registerWorld(ioServer as any, db);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const addr = http.address();
  if (addr && typeof addr === "object") port = addr.port;

  // Capture the seeded demo rooms by connecting a probe client once.
  const probe = Client(`http://localhost:${port}`);
  const welcome = await once<{ selfId: string; rooms: Room[] }>(probe, "welcome");
  rooms = welcome.rooms;
  probe.disconnect();
});

afterEach(async () => {
  ioServer.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

function connect(): ClientSocket {
  return Client(`http://localhost:${port}`, { forceNew: true });
}

describe("world integration", () => {
  it("seeds 2 demo rooms and welcomes a client with selfId", async () => {
    const a = connect();
    const welcome = await once<{ selfId: string; rooms: Room[] }>(a, "welcome");
    expect(welcome.rooms).toHaveLength(2);
    expect(typeof welcome.selfId).toBe("string");
    a.disconnect();
  });

  it("broadcasts move from one client to the other in the same room", async () => {
    const a = connect();
    const b = connect();
    const wa = await once<{ selfId: string; rooms: Room[] }>(a, "welcome");
    await once(b, "welcome");

    // a should learn about b joining (or b about a); wait for both to settle.
    await once<{ entity: Entity }>(a, "entityJoined").catch(() => {});

    const movedP = once<{ id: string; pos: Vec2; facing: Facing }>(b, "entityMoved");
    a.emit("move", { pos: { x: 7, y: 9 }, facing: "E" });
    const moved = await movedP;

    expect(moved.id).toBe(wa.selfId);
    expect(moved.pos).toEqual({ x: 7, y: 9 });
    expect(moved.facing).toBe("E");
    a.disconnect();
    b.disconnect();
  });

  it("broadcasts chat to other clients in the room", async () => {
    const a = connect();
    const b = connect();
    await once(a, "welcome");
    await once(b, "welcome");

    const chatP = once<{ message: ChatMessage }>(b, "chat");
    a.emit("chat", { text: "hello world" });
    const { message } = await chatP;

    expect(message.text).toBe("hello world");
    expect(typeof message.id).toBe("string");
    expect(typeof message.ts).toBe("number");
    a.disconnect();
    b.disconnect();
  });

  it("enterRoom moves the client: roomState for the new room, entityLeft to the old", async () => {
    const a = connect();
    const b = connect(); // stays in room[0] to observe a leaving
    const wa = await once<{ selfId: string; rooms: Room[] }>(a, "welcome");
    await once(b, "welcome");

    const leftP = once<{ id: string }>(b, "entityLeft");
    const stateP = once<{ roomId: string; entities: Entity[] }>(a, "roomState");
    a.emit("enterRoom", { roomId: rooms[1].id });

    const left = await leftP;
    const state = await stateP;

    expect(left.id).toBe(wa.selfId);
    expect(state.roomId).toBe(rooms[1].id);
    expect(state.entities.some((e) => e.id === wa.selfId)).toBe(true);
    a.disconnect();
    b.disconnect();
  });

  it("disconnect broadcasts entityLeft to remaining room occupants", async () => {
    const a = connect();
    const b = connect();
    const wa = await once<{ selfId: string; rooms: Room[] }>(a, "welcome");
    await once(b, "welcome");

    const leftP = once<{ id: string }>(b, "entityLeft");
    a.disconnect();
    const left = await leftP;
    expect(left.id).toBe(wa.selfId);
    b.disconnect();
  });
});
```

- [ ] **Step 3: Run it; expect PASS**

Run: `npm test -w server -- integration`
Expected: PASS (5 tests). If a flake appears on the `entityJoined` settle line, it is wrapped in `.catch(() => {})` and non-fatal; the move/chat assertions are deterministic because both clients share room[0].

- [ ] **Step 4: Run the whole server suite**

Run: `npm test -w server`
Expected: PASS — `state`, `rooms`, `integration`, plus S0's `db` test.

- [ ] **Step 5: Commit**

```bash
git add server/src/world/integration.test.ts server/package.json package-lock.json
git commit -m "test(world): two-client socket.io integration (move/chat/enterRoom)"
```

---

### Task 5: Pure isometric projection (`iso.ts`)

Grid↔screen projection helpers for placing avatars on the floor. Pure and unit-tested; the Three.js scene consumes these so the math stays testable.

**Files:**
- Create: `client/src/render/iso.ts`
- Create: `client/src/render/iso.test.ts`
- Modify: `client/package.json` (ensure `vitest` + `test` script exist for the client)

- [ ] **Step 1: Ensure the client has a Vitest test script**

In `client/package.json`, add to `scripts` (if not present):

```json
"test": "vitest run"
```

and add to `devDependencies` (if not present):

```json
"vitest": "^2.0.0"
```

Then install:

Run: `npm install`
Expected: vitest available in the client workspace.

- [ ] **Step 2: Write the failing test `client/src/render/iso.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { gridToWorld, worldToGrid, FLOOR_SIZE } from "./iso";

describe("iso projection", () => {
  it("maps grid (0,0) to the back corner of the floor", () => {
    const w = gridToWorld({ x: 0, y: 0 }, 30, 30);
    expect(w.x).toBeCloseTo(-FLOOR_SIZE / 2 + 0.5);
    expect(w.z).toBeCloseTo(-FLOOR_SIZE / 2 + 0.5);
  });

  it("maps the far grid corner near the opposite floor edge", () => {
    const w = gridToWorld({ x: 29, y: 29 }, 30, 30);
    expect(w.x).toBeCloseTo(FLOOR_SIZE / 2 - 0.5);
    expect(w.z).toBeCloseTo(FLOOR_SIZE / 2 - 0.5);
  });

  it("centers a tile and keeps y at floor level (0)", () => {
    const w = gridToWorld({ x: 15, y: 15 }, 30, 30);
    expect(w.y).toBe(0);
  });

  it("worldToGrid is the inverse of gridToWorld (rounded)", () => {
    for (const g of [
      { x: 0, y: 0 },
      { x: 5, y: 12 },
      { x: 29, y: 29 },
      { x: 14, y: 3 },
    ]) {
      const w = gridToWorld(g, 30, 30);
      expect(worldToGrid(w, 30, 30)).toEqual(g);
    }
  });

  it("worldToGrid clamps out-of-bounds world points into the grid", () => {
    const far = { x: 9999, y: 0, z: 9999 };
    const g = worldToGrid(far, 30, 30);
    expect(g.x).toBe(29);
    expect(g.y).toBe(29);
    const neg = { x: -9999, y: 0, z: -9999 };
    const g2 = worldToGrid(neg, 30, 30);
    expect(g2.x).toBe(0);
    expect(g2.y).toBe(0);
  });

  it("scales tile size with room dimensions", () => {
    const small = gridToWorld({ x: 0, y: 0 }, 10, 10);
    // tile size = FLOOR_SIZE/10 = 3; center offset = 1.5
    expect(small.x).toBeCloseTo(-FLOOR_SIZE / 2 + 1.5);
  });
});
```

- [ ] **Step 3: Run it; expect FAIL**

Run: `npm test -w client -- iso`
Expected: FAIL — `Cannot find module './iso'`.

- [ ] **Step 4: Implement `client/src/render/iso.ts`**

```ts
import type { Vec2 } from "shared/types";

// World-space floor size (matches the Three.js room slab). Grid tiles are mapped
// onto a FLOOR_SIZE x FLOOR_SIZE slab centered on the origin, top face at y = 0.
export const FLOOR_SIZE = 30;

export interface World3 {
  x: number;
  y: number;
  z: number;
}

function tileSize(width: number, height: number): { tx: number; tz: number } {
  return { tx: FLOOR_SIZE / width, tz: FLOOR_SIZE / height };
}

/** Grid tile (integer x,y) -> world-space center on the floor (y = 0). */
export function gridToWorld(g: Vec2, width: number, height: number): World3 {
  const { tx, tz } = tileSize(width, height);
  return {
    x: -FLOOR_SIZE / 2 + (g.x + 0.5) * tx,
    y: 0,
    z: -FLOOR_SIZE / 2 + (g.y + 0.5) * tz,
  };
}

/** World-space point -> nearest grid tile, clamped into [0,width) x [0,height). */
export function worldToGrid(w: World3, width: number, height: number): Vec2 {
  const { tx, tz } = tileSize(width, height);
  const gx = Math.round((w.x + FLOOR_SIZE / 2) / tx - 0.5);
  const gy = Math.round((w.z + FLOOR_SIZE / 2) / tz - 0.5);
  return {
    x: Math.max(0, Math.min(width - 1, gx)),
    y: Math.max(0, Math.min(height - 1, gy)),
  };
}
```

- [ ] **Step 5: Run it; expect PASS**

Run: `npm test -w client -- iso`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/render/iso.ts client/src/render/iso.test.ts client/package.json package-lock.json
git commit -m "feat(render): pure isometric grid<->world projection with tests"
```

---

### Task 6: Pure entity-store reducer (`entityStore.ts`)

A pure reducer that folds `roomState`/`entityJoined`/`entityMoved`/`entityLeft` into an entity map. The render layer derives meshes from this; keeping it pure makes the sync logic unit-testable without Three.js.

**Files:**
- Create: `client/src/render/entityStore.ts`
- Create: `client/src/render/entityStore.test.ts`

- [ ] **Step 1: Write the failing test `client/src/render/entityStore.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { emptyStore, applyEvent, type EntityStore } from "./entityStore";
import type { Entity } from "shared/types";

function ent(id: string, x = 1, y = 1): Entity {
  return {
    id,
    type: "player",
    roomId: "r1",
    pos: { x, y },
    facing: "S",
    displayName: id,
    avatarSeed: "0x" + id,
  };
}

describe("entityStore reducer", () => {
  it("emptyStore has no entities and no room", () => {
    const s = emptyStore();
    expect(Object.keys(s.entities)).toEqual([]);
    expect(s.roomId).toBeUndefined();
  });

  it("roomState replaces the whole entity set and sets roomId", () => {
    let s: EntityStore = emptyStore();
    s = applyEvent(s, { type: "roomState", roomId: "r1", entities: [ent("a"), ent("b")] });
    expect(Object.keys(s.entities).sort()).toEqual(["a", "b"]);
    expect(s.roomId).toBe("r1");

    s = applyEvent(s, { type: "roomState", roomId: "r2", entities: [ent("c")] });
    expect(Object.keys(s.entities)).toEqual(["c"]);
    expect(s.roomId).toBe("r2");
  });

  it("entityJoined adds an entity", () => {
    let s = emptyStore();
    s = applyEvent(s, { type: "entityJoined", entity: ent("a") });
    expect(s.entities["a"].id).toBe("a");
  });

  it("entityMoved updates pos and facing for a known entity", () => {
    let s = emptyStore();
    s = applyEvent(s, { type: "entityJoined", entity: ent("a", 0, 0) });
    s = applyEvent(s, { type: "entityMoved", id: "a", pos: { x: 4, y: 5 }, facing: "W" });
    expect(s.entities["a"].pos).toEqual({ x: 4, y: 5 });
    expect(s.entities["a"].facing).toBe("W");
  });

  it("entityMoved for an unknown id is ignored", () => {
    let s = emptyStore();
    s = applyEvent(s, { type: "entityMoved", id: "ghost", pos: { x: 1, y: 1 }, facing: "N" });
    expect(s.entities["ghost"]).toBeUndefined();
  });

  it("entityLeft removes an entity", () => {
    let s = emptyStore();
    s = applyEvent(s, { type: "entityJoined", entity: ent("a") });
    s = applyEvent(s, { type: "entityLeft", id: "a" });
    expect(s.entities["a"]).toBeUndefined();
  });

  it("is immutable: returns a new object and does not mutate the input", () => {
    const s0 = emptyStore();
    const s1 = applyEvent(s0, { type: "entityJoined", entity: ent("a") });
    expect(s1).not.toBe(s0);
    expect(Object.keys(s0.entities)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `npm test -w client -- entityStore`
Expected: FAIL — `Cannot find module './entityStore'`.

- [ ] **Step 3: Implement `client/src/render/entityStore.ts`**

```ts
import type { Entity, Vec2, Facing } from "shared/types";

export interface EntityStore {
  roomId?: string;
  entities: Record<string, Entity>;
}

export type StoreEvent =
  | { type: "roomState"; roomId: string; entities: Entity[] }
  | { type: "entityJoined"; entity: Entity }
  | { type: "entityMoved"; id: string; pos: Vec2; facing: Facing }
  | { type: "entityLeft"; id: string };

export function emptyStore(): EntityStore {
  return { entities: {} };
}

/** Pure reducer: folds a socket event into a new EntityStore (no mutation). */
export function applyEvent(s: EntityStore, ev: StoreEvent): EntityStore {
  switch (ev.type) {
    case "roomState": {
      const entities: Record<string, Entity> = {};
      for (const e of ev.entities) entities[e.id] = e;
      return { roomId: ev.roomId, entities };
    }
    case "entityJoined": {
      return {
        ...s,
        entities: { ...s.entities, [ev.entity.id]: ev.entity },
      };
    }
    case "entityMoved": {
      const prev = s.entities[ev.id];
      if (!prev) return s;
      return {
        ...s,
        entities: {
          ...s.entities,
          [ev.id]: { ...prev, pos: ev.pos, facing: ev.facing },
        },
      };
    }
    case "entityLeft": {
      if (!s.entities[ev.id]) return s;
      const entities = { ...s.entities };
      delete entities[ev.id];
      return { ...s, entities };
    }
  }
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w client -- entityStore`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/render/entityStore.ts client/src/render/entityStore.test.ts
git commit -m "feat(render): pure entity-store reducer for socket sync with tests"
```

---

### Task 7: Three.js isometric scene (`scene.ts`)

Orthographic isometric scene (camera, lights, textured floor + walls) modeled on the reference renderer (`src/client/room.js` + `main.js`), wrapped in an imperative API the React canvas drives. No unit test (rendering); logic lives in the tested pure modules.

**Files:**
- Create: `client/src/render/scene.ts`

- [ ] **Step 1: Implement `client/src/render/scene.ts`**

```ts
import * as THREE from "three";
import { FLOOR_SIZE, gridToWorld, worldToGrid } from "./iso.js";
import type { Vec2 } from "shared/types";

const WALL_HEIGHT = 15;
const THICKNESS = 1;
const FRUSTUM_SIZE = 50;

export interface IsoScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  /** Add a mesh group (avatar) to the floor layer. */
  add(obj: THREE.Object3D): void;
  remove(obj: THREE.Object3D): void;
  /** Grid tile -> world center (y=0), using the current room size. */
  gridToWorld(g: Vec2): THREE.Vector3;
  /** Screen pixel -> grid tile via floor raycast (null if off-floor). */
  pickGrid(clientX: number, clientY: number): Vec2 | null;
  setRoomSize(width: number, height: number): void;
  resize(): void;
  start(): void;
  dispose(): void;
}

function makeRoom(): THREE.Group {
  const room = new THREE.Group();
  const half = FLOOR_SIZE / 2;
  const wallY = WALL_HEIGHT / 2;
  const inset = half - THICKNESS / 2;

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_SIZE, THICKNESS, FLOOR_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x6b5334 })
  );
  floor.position.set(0, -THICKNESS / 2, 0);
  floor.name = "floor";

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xece6da });
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_SIZE, WALL_HEIGHT, THICKNESS),
    wallMat
  );
  backWall.position.set(0, wallY, -inset);
  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(THICKNESS, WALL_HEIGHT, FLOOR_SIZE),
    wallMat
  );
  leftWall.position.set(-inset, wallY, 0);

  room.add(floor, backWall, leftWall);
  return room;
}

export function createScene(container: HTMLElement): IsoScene {
  let roomW = 30;
  let roomH = 30;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151c);

  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.OrthographicCamera(
    (-FRUSTUM_SIZE * aspect) / 2,
    (FRUSTUM_SIZE * aspect) / 2,
    FRUSTUM_SIZE / 2,
    -FRUSTUM_SIZE / 2,
    0.1,
    1000
  );
  camera.position.set(40, 40, 40);
  camera.lookAt(0, 6, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(20, 40, 20);
  scene.add(dir);

  const room = makeRoom();
  scene.add(room);
  const floorMesh = room.getObjectByName("floor") as THREE.Mesh;

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let raf = 0;

  function render() {
    renderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    renderer,
    add: (o) => scene.add(o),
    remove: (o) => scene.remove(o),
    gridToWorld(g: Vec2) {
      const w = gridToWorld(g, roomW, roomH);
      return new THREE.Vector3(w.x, w.y, w.z);
    },
    pickGrid(clientX: number, clientY: number): Vec2 | null {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(floorMesh, false)[0];
      if (!hit) return null;
      return worldToGrid(
        { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        roomW,
        roomH
      );
    },
    setRoomSize(width: number, height: number) {
      roomW = width;
      roomH = height;
    },
    resize() {
      const a = container.clientWidth / container.clientHeight || 1;
      camera.left = (-FRUSTUM_SIZE * a) / 2;
      camera.right = (FRUSTUM_SIZE * a) / 2;
      camera.top = FRUSTUM_SIZE / 2;
      camera.bottom = -FRUSTUM_SIZE / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      render();
    },
    start() {
      const loop = () => {
        raf = requestAnimationFrame(loop);
        render();
      };
      loop();
    },
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
```

- [ ] **Step 2: Type-check the client**

Run: `npx -w client tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/render/scene.ts
git commit -m "feat(render): orthographic isometric Three.js scene (floor+walls+pick)"
```

---

### Task 8: Avatar meshes + nameplates (`avatars.ts`)

Create/update colored avatar meshes (color from `avatarSeedToColor`) with a floating sprite nameplate showing `displayName`. Imperative manager keyed by entity id; driven by the entity store.

**Files:**
- Create: `client/src/render/avatars.ts`

- [ ] **Step 1: Implement `client/src/render/avatars.ts`**

```ts
import * as THREE from "three";
import type { Entity } from "shared/types";
import { avatarSeedToColor } from "shared/avatar";
import type { IsoScene } from "./scene.js";

const AVATAR_RADIUS = 1.1;
const AVATAR_HEIGHT = 3;

function makeNameplate(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 22), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(8, 2, 1);
  sprite.position.set(0, AVATAR_HEIGHT + 2.5, 0);
  sprite.name = "nameplate";
  return sprite;
}

function makeAvatar(entity: Entity): THREE.Group {
  const group = new THREE.Group();
  group.name = `avatar-${entity.id}`;

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(AVATAR_RADIUS, AVATAR_HEIGHT - AVATAR_RADIUS * 2, 6, 12),
    new THREE.MeshStandardMaterial({ color: avatarSeedToColor(entity.avatarSeed) })
  );
  body.position.y = AVATAR_HEIGHT / 2;
  body.name = "body";
  group.add(body);

  group.add(makeNameplate(entity.displayName));
  return group;
}

/** Manages avatar meshes for a set of entities, keyed by id. */
export class AvatarManager {
  private map = new Map<string, THREE.Group>();

  constructor(private scene: IsoScene) {}

  /** Reconcile the rendered avatars to exactly the given entities. */
  sync(entities: Record<string, Entity>, selfId?: string): void {
    const wanted = new Set(Object.keys(entities));

    // Remove stale.
    for (const [id, group] of this.map) {
      if (!wanted.has(id)) {
        this.scene.remove(group);
        this.map.delete(id);
      }
    }

    // Add / update.
    for (const id of wanted) {
      const e = entities[id];
      let group = this.map.get(id);
      if (!group) {
        group = makeAvatar(e);
        this.map.set(id, group);
        this.scene.add(group);
      } else {
        const plate = group.getObjectByName("nameplate") as THREE.Sprite | null;
        if (plate && plate.userData.text !== e.displayName) {
          group.remove(plate);
          const fresh = makeNameplate(e.displayName);
          fresh.userData.text = e.displayName;
          group.add(fresh);
        }
      }
      const w = this.scene.gridToWorld(e.pos);
      group.position.set(w.x, 0, w.z);
      const body = group.getObjectByName("body") as THREE.Mesh | null;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        // Highlight self with a subtle emissive ring of color.
        mat.emissive = new THREE.Color(id === selfId ? 0x224466 : 0x000000);
      }
    }
  }

  dispose(): void {
    for (const group of this.map.values()) this.scene.remove(group);
    this.map.clear();
  }
}
```

- [ ] **Step 2: Type-check the client**

Run: `npx -w client tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/render/avatars.ts
git commit -m "feat(render): avatar meshes colored by seed with nameplate sprites"
```

---

### Task 9: React render canvas (`RenderCanvas.tsx`)

React component: connect via `connectSocket()` (dev mode, no token yet), feed socket events through `entityStore`, drive scene + `AvatarManager`, and handle click-to-move / WASD → `socket.emit("move", …)`. Shares socket + room list via a small context so ChatBox/WorldView can reuse them.

**Files:**
- Create: `client/src/render/RenderContext.ts`
- Create: `client/src/render/RenderCanvas.tsx`

- [ ] **Step 1: Create the shared render context `client/src/render/RenderContext.ts`**

```ts
import { createContext, useContext } from "react";
import type { AppSocket } from "../net/socket.js";
import type { Room } from "shared/types";

export interface RenderContextValue {
  socket: AppSocket | null;
  rooms: Room[];
  currentRoomId?: string;
  selfId?: string;
}

export const RenderContext = createContext<RenderContextValue>({
  socket: null,
  rooms: [],
});

export function useRender(): RenderContextValue {
  return useContext(RenderContext);
}
```

- [ ] **Step 2: Implement `client/src/render/RenderCanvas.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { connectSocket, type AppSocket } from "../net/socket.js";
import { createScene, type IsoScene } from "./scene.js";
import { AvatarManager } from "./avatars.js";
import { emptyStore, applyEvent, type EntityStore } from "./entityStore.js";
import { RenderContext, type RenderContextValue } from "./RenderContext.js";
import type { Room, Vec2, Facing } from "shared/types";
import ChatBox from "../ui/ChatBox.js";
import WorldView from "../ui/WorldView.js";

const WASD: Record<string, { d: Vec2; facing: Facing }> = {
  w: { d: { x: 0, y: -1 }, facing: "N" },
  s: { d: { x: 0, y: 1 }, facing: "S" },
  a: { d: { x: -1, y: 0 }, facing: "W" },
  d: { d: { x: 1, y: 0 }, facing: "E" },
};

export default function RenderCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<RenderContextValue>({ socket: null, rooms: [] });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene: IsoScene = createScene(mount);
    const avatars = new AvatarManager(scene);
    const socket: AppSocket = connectSocket();

    let store: EntityStore = emptyStore();
    let selfId: string | undefined;
    let selfPos: Vec2 = { x: 15, y: 15 };
    let rooms: Room[] = [];

    const rerender = () => {
      avatars.sync(store.entities, selfId);
      if (selfId && store.entities[selfId]) {
        selfPos = store.entities[selfId].pos;
      }
      setCtx({
        socket,
        rooms,
        currentRoomId: store.roomId,
        selfId,
      });
    };

    socket.on("welcome", ({ selfId: sid, rooms: rs }) => {
      selfId = sid;
      rooms = rs;
      const room = rs.find((r) => r.id === store.roomId) ?? rs[0];
      if (room) scene.setRoomSize(room.width, room.height);
      rerender();
    });
    socket.on("roomState", (p) => {
      store = applyEvent(store, { type: "roomState", roomId: p.roomId, entities: p.entities });
      const room = rooms.find((r) => r.id === p.roomId);
      if (room) scene.setRoomSize(room.width, room.height);
      rerender();
    });
    socket.on("entityJoined", (p) => {
      store = applyEvent(store, { type: "entityJoined", entity: p.entity });
      rerender();
    });
    socket.on("entityMoved", (p) => {
      store = applyEvent(store, { type: "entityMoved", id: p.id, pos: p.pos, facing: p.facing });
      rerender();
    });
    socket.on("entityLeft", (p) => {
      store = applyEvent(store, { type: "entityLeft", id: p.id });
      rerender();
    });
    socket.on("roomList", (p) => {
      rooms = p.rooms;
      rerender();
    });

    const emitMove = (pos: Vec2, facing: Facing) => {
      selfPos = pos;
      socket.emit("move", { pos, facing });
    };

    const onClick = (ev: MouseEvent) => {
      const g = scene.pickGrid(ev.clientX, ev.clientY);
      if (!g) return;
      const facing: Facing =
        Math.abs(g.x - selfPos.x) > Math.abs(g.y - selfPos.y)
          ? g.x >= selfPos.x ? "E" : "W"
          : g.y >= selfPos.y ? "S" : "N";
      emitMove(g, facing);
    };

    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const step = WASD[ev.key.toLowerCase()];
      if (!step) return;
      const room = rooms.find((r) => r.id === store.roomId);
      const w = room?.width ?? 30;
      const h = room?.height ?? 30;
      const next: Vec2 = {
        x: Math.max(0, Math.min(w - 1, selfPos.x + step.d.x)),
        y: Math.max(0, Math.min(h - 1, selfPos.y + step.d.y)),
      };
      emitMove(next, step.facing);
    };

    const canvas = scene.renderer.domElement;
    canvas.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", scene.resize);
    scene.start();

    return () => {
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", scene.resize);
      socket.disconnect();
      avatars.dispose();
      scene.dispose();
    };
  }, []);

  return (
    <RenderContext.Provider value={ctx}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <WorldView />
      <ChatBox />
    </RenderContext.Provider>
  );
}
```

- [ ] **Step 3: Type-check after Tasks 10 + 11 create ChatBox/WorldView**

(Defer the client typecheck to Task 11 Step 3, after the two imported UI files exist.)

- [ ] **Step 4: Commit**

```bash
git add client/src/render/RenderContext.ts client/src/render/RenderCanvas.tsx
git commit -m "feat(render): RenderCanvas wiring socket->store->scene + input"
```

---

### Task 10: Chat box UI (`ChatBox.tsx`)

Message list + input emitting `chat`. Listens on the shared socket for `chat` events and shows the room's messages.

**Files:**
- Create: `client/src/ui/ChatBox.tsx`

- [ ] **Step 1: Implement `client/src/ui/ChatBox.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "shared/types";
import { useRender } from "../render/RenderContext.js";

export default function ChatBox() {
  const { socket } = useRender();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;
    const onChat = (p: { message: ChatMessage }) =>
      setMessages((prev) => [...prev.slice(-49), p.message]);
    socket.on("chat", onChat);
    return () => {
      socket.off("chat", onChat);
    };
  }, [socket]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = () => {
    const t = text.trim();
    if (!t || !socket) return;
    socket.emit("chat", { text: t });
    setText("");
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
        width: 320,
        background: "rgba(17,21,28,0.85)",
        borderRadius: 8,
        padding: 8,
        color: "#dfe7ee",
        fontFamily: "sans-serif",
        fontSize: 13,
      }}
    >
      <div ref={listRef} style={{ maxHeight: 160, overflowY: "auto", marginBottom: 6 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 2 }}>
            <span style={{ color: "#7fd0a0", fontWeight: 600 }}>{m.senderName}</span>
            <span>: {m.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Say something…"
          style={{
            flex: 1,
            background: "#0b0e13",
            border: "1px solid #2a3340",
            borderRadius: 4,
            color: "#fff",
            padding: "4px 6px",
          }}
        />
        <button onClick={send} style={{ cursor: "pointer" }}>
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/ChatBox.tsx
git commit -m "feat(ui): ChatBox message list + input emitting chat"
```

---

### Task 11: World view UI (`WorldView.tsx`) + App mount

List rooms (from `welcome`/`roomList`) and select → emit `enterRoom`. Then mount `<RenderCanvas/>` in `App.tsx`.

**Files:**
- Create: `client/src/ui/WorldView.tsx`
- Modify: `client/src/App.tsx` (mount `<RenderCanvas/>` — replaces the scaffold placeholder comment)

- [ ] **Step 1: Implement `client/src/ui/WorldView.tsx`**

```tsx
import { useRender } from "../render/RenderContext.js";

export default function WorldView() {
  const { socket, rooms, currentRoomId } = useRender();

  const enter = (roomId: string) => {
    if (!socket || roomId === currentRoomId) return;
    socket.emit("enterRoom", { roomId });
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 240,
        background: "rgba(17,21,28,0.85)",
        borderRadius: 8,
        padding: 8,
        color: "#dfe7ee",
        fontFamily: "sans-serif",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Rooms</div>
      {rooms.length === 0 && <div style={{ opacity: 0.6 }}>Connecting…</div>}
      {rooms.map((r) => {
        const active = r.id === currentRoomId;
        return (
          <button
            key={r.id}
            onClick={() => enter(r.id)}
            disabled={active}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              marginBottom: 4,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #2a3340",
              background: active ? "#1d3b2b" : "#0b0e13",
              color: "#fff",
              cursor: active ? "default" : "pointer",
            }}
          >
            {r.ensName ?? r.id.slice(0, 8)}
            {active && " ●"}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Mount `<RenderCanvas/>` in `client/src/App.tsx`** — replace the scaffold body. Replace the `{/* <RenderCanvas/>  S2 */}` placeholder line and the scaffold text div with the real mount.

Final `client/src/App.tsx`:

```tsx
import RenderCanvas from "./render/RenderCanvas.js";

export default function App() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <RenderCanvas />
      {/* <WalletPanel/>   S3 */}
      {/* <TxFeed/>        S3 */}
    </div>
  );
}
```

- [ ] **Step 3: Type-check the whole client (now all imports resolve)**

Run: `npx -w client tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/WorldView.tsx client/src/App.tsx
git commit -m "feat(ui): WorldView room switcher + mount RenderCanvas in App"
```

---

### Task 12: Full-stream verification (two-window manual test)

End-to-end check that the standalone S2 slice works (demo steps 1–3 minus onchain), driven by the dev-identity fallback.

**Files:** none (verification only)

- [ ] **Step 1: Run all automated tests**

Run: `npm test`
Expected: shared + server suites PASS (includes `state`, `rooms`, `integration`). Then run `npm test -w client` → `iso` + `entityStore` PASS.

- [ ] **Step 2: Boot server + client**

Run (two shells): `npm run dev:server` and `npm run dev:client`
Expected: server logs `bitopia server on :8787`; client serves on Vite's port.

- [ ] **Step 3: Two-window manual smoke test**

1. Open the client in two browser windows.
2. Both spawn into demo room 1; each sees the other's avatar with a nameplate (dev id).
3. In window A, click on the floor / press WASD → window B sees A's avatar move in real time, and vice-versa.
4. In window A, type a chat message → it appears in both windows' ChatBox.
5. In window B, click demo room 2 in WorldView → B's avatar leaves room 1 (disappears from A) and B is alone in room 2; move A into room 2 and confirm they re-converge.

Expected: all of the above hold. This is the S2 acceptance bar.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(world): S2 verification pass"
```

---

## Self-review notes
- **Seam binding:** Server uses `Entity`/`Room`/`ChatMessage`/`Vec2`/`Facing`/`TxRecord`/`SocketUser` from `shared/types`, the `ClientToServer`/`ServerToClient` events from `shared/protocol`, reads `socket.data.user` (via `socketTypes.ts`), and implements + assigns the `worldApi` singleton exactly per the overview's WorldApi seam (addEntity/moveEntity/removeEntity/roomEntities/emitChat/emitTx, each broadcasting the matching protocol event). Client uses `connectSocket()`/`AppSocket` from S0's `net/socket.ts` and `avatarSeedToColor` from `shared/avatar`.
- **Dev-mode identity:** when `socket.data.user` is unset (S3 not merged), `registerWorld` generates `dev-<uuid>` placed in demo room 1, so two windows work standalone. When S3 lands, its middleware sets `socket.data.user` and the same code path uses the real identity — no S2 change needed.
- **Owned paths only:** all new files live under `server/src/world/**`, `client/src/render/**`, `client/src/ui/ChatBox.tsx`, `client/src/ui/WorldView.tsx`. The only edits outside those are the single registration line in `server/src/index.ts` and the `<RenderCanvas/>` mount in `client/src/App.tsx` (the overview-sanctioned merge points), plus adding `socket.io-client`/`vitest` to existing package.json files. (`client/src/render/RenderContext.ts` is added under the owned `render/` dir to share the socket with the two UI files without touching other streams' code.)
- **No blockchain:** `emitTx` only broadcasts pre-built `TxRecord`s handed in by S3/S4; S2 never builds or signs anything onchain.
- **Testability:** all logic (world state, projection, store reducer) is in pure modules with full unit tests; the socket layer has a real two-client integration test; Three.js rendering is verified by run-and-observe per the brief.
