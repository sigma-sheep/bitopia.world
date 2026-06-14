import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { ClientToServer, ServerToClient } from "shared/protocol";
import type { ChatMessage, Entity, Room, SocketUser } from "shared/types";
import { RoomStore } from "./store";
import { randomSpawn, clampToFloor } from "./spawn";

type IO = Server<ClientToServer, ServerToClient>;
type IOSocket = Socket<ClientToServer, ServerToClient>;

// The one shared room everyone lands in this pass. Off-chain, no owner UI yet.
const LOBBY: Room = { id: "lobby", ownerUserId: "system", width: 20, height: 20 };

// A short address fallback when the player hasn't claimed an ENS name yet.
function displayNameFor(user: SocketUser): string {
  if (user.ensName) return user.ensName;
  return `${user.address.slice(0, 6)}…${user.address.slice(-4)}`;
}

// Presence only: on connect a player is rendered with its authenticated identity
// (set by the auth middleware as socket.data.user) and a server-chosen spawn, and
// is told who's already here; everyone else is told it arrived. Reverse on leave.
export function registerRoom(io: IO): void {
  const store = new RoomStore();

  io.on("connection", (socket: IOSocket) => {
    const user = (socket.data as { user?: SocketUser }).user;
    if (!user) {
      // Should never happen (the auth middleware rejects tokenless sockets), but
      // never spawn an unauthenticated entity.
      socket.disconnect(true);
      return;
    }
    const id = user.id;
    const entity: Entity = {
      id,
      type: "player",
      roomId: LOBBY.id,
      pos: randomSpawn(LOBBY.width, LOBBY.height),
      facing: "S",
      displayName: displayNameFor(user),
      ensName: user.ensName,
      avatarSeed: user.avatarSeed,
      address: user.address,
    };

    socket.join(LOBBY.id);
    store.add(entity);
    // Newcomer learns its own id and the rooms, then the full occupant list —
    // self included, so it renders its own avatar at the server-chosen spot.
    socket.emit("welcome", { selfId: id, rooms: [LOBBY] });
    socket.emit("roomState", { roomId: LOBBY.id, entities: store.list() });
    // Existing occupants only get the newcomer (the newcomer already has it via
    // roomState, so `socket.to` — which excludes the sender — avoids a duplicate).
    socket.to(LOBBY.id).emit("entityJoined", { entity });

    // Click-to-move: the client requests a destination; the server is
    // authoritative. Clamp into the walkable inset, persist it, then broadcast to
    // the WHOLE room (io.to, not socket.to) so the mover sees its own avatar glide
    // too — that round-trip keeps every client's position in lockstep.
    socket.on("move", ({ pos, facing }) => {
      const target = clampToFloor(pos, LOBBY.width, LOBBY.height);
      const updated = store.update(id, { pos: target, facing });
      if (!updated) return; // unknown/forged id — ignore
      io.to(LOBBY.id).emit("entityMoved", { id, pos: target, facing });
    });

    // Chat: ephemeral, room-wide broadcast (io.to, not socket.to) so the sender
    // sees its own bubble too. Trim and cap server-side; never trust client text.
    socket.on("chat", ({ text }) => {
      const trimmed = text.trim().slice(0, 280);
      if (!trimmed) return;
      const message: ChatMessage = {
        id: randomUUID(),
        roomId: LOBBY.id,
        senderId: id,
        senderName: displayNameFor(user),
        text: trimmed,
        ts: Date.now(),
      };
      io.to(LOBBY.id).emit("chat", { message });
    });

    socket.on("disconnect", () => {
      store.remove(id);
      io.to(LOBBY.id).emit("entityLeft", { id });
    });
  });
}
