import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { ServerToClient } from "shared/protocol";
import type { Entity } from "shared/types";
import { registerRoom } from "./handlers";

// Boots a real in-process server on an ephemeral port so the presence flow is
// exercised over an actual socket — no shared port, no orphan processes.
let server: http.Server;
let io: Server;
let url: string;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  server = http.createServer();
  io = new Server(server);
  registerRoom(io);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.forEach((c) => c.close());
  clients.length = 0;
  io.close();
  await new Promise<void>((r) => server.close(() => r()));
});

function connect() {
  const c: ClientSocket = ioc(url, { auth: {}, reconnection: false });
  clients.push(c);
  return c;
}

// Resolve once a given event fires on a client.
function once<E extends keyof ServerToClient>(c: ClientSocket, event: E) {
  return new Promise<Parameters<ServerToClient[E]>[0]>((resolve) => c.once(event, resolve as never));
}

describe("room presence", () => {
  it("first player sees only itself in its snapshot", async () => {
    const a = connect();
    const state = await once(a, "roomState");
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0]).toMatchObject<Partial<Entity>>({ type: "player", roomId: "lobby" });
  });

  it("existing player is notified when a new player joins", async () => {
    const a = connect();
    await once(a, "roomState"); // a is settled in the room

    const joined = once(a, "entityJoined");
    const b = connect();
    const bWelcome = await once(b, "welcome");

    const evt = await joined;
    expect(evt.entity.id).toBe(bWelcome.selfId); // a saw exactly b
  });

  it("new player's snapshot includes everyone already present, itself included", async () => {
    const a = connect();
    await once(a, "roomState");

    const b = connect();
    const bState = await once(b, "roomState");
    expect(bState.entities).toHaveLength(2);
  });

  it("remaining player is notified when another leaves", async () => {
    const a = connect();
    await once(a, "roomState");

    // Register before connecting b so we never miss the join broadcast.
    const joined = once(a, "entityJoined");
    const b = connect();
    const bWelcome = await once(b, "welcome");
    await joined;

    const left = once(a, "entityLeft");
    b.close();
    const evt = await left;
    expect(evt.id).toBe(bWelcome.selfId);
  });
});
