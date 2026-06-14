import type { Entity, Vec2, Facing, ChatMessage } from "shared/types";
import { connectSocket } from "./socket";

// Imperative bridge between the socket and the three.js scene. The canvas owns
// the meshes; this just turns presence/movement events into add/remove/move
// calls. Returns sendMove (click → server) and a disconnect for unmount cleanup.
export interface RoomCallbacks {
  onSnapshot: (entities: Entity[]) => void; // full occupant list on join (incl. self)
  onJoined: (entity: Entity) => void;
  onLeft: (id: string) => void;
  onMoved: (id: string, pos: Vec2, facing: Facing) => void; // authoritative move echo
  onWelcome: (selfId: string) => void;                      // which entity is us
  onChat: (message: ChatMessage) => void;                   // room-wide chat broadcast
}

export interface RoomConnection {
  sendMove: (pos: Vec2, facing: Facing) => void;
  sendChat: (text: string) => void;
  disconnect: () => void;
}

export function connectRoom(cb: RoomCallbacks, privyToken?: string): RoomConnection {
  const socket = connectSocket(privyToken); // token authenticates the handshake
  socket.on("welcome", ({ selfId }) => cb.onWelcome(selfId));
  socket.on("roomState", ({ entities }) => cb.onSnapshot(entities));
  socket.on("entityJoined", ({ entity }) => cb.onJoined(entity));
  socket.on("entityLeft", ({ id }) => cb.onLeft(id));
  socket.on("entityMoved", ({ id, pos, facing }) => cb.onMoved(id, pos, facing));
  socket.on("chat", ({ message }) => cb.onChat(message));
  return {
    sendMove: (pos, facing) => socket.emit("move", { pos, facing }),
    sendChat: (text) => socket.emit("chat", { text }),
    disconnect: () => socket.disconnect(),
  };
}
