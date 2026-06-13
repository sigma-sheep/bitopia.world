import type { Entity } from "shared/types";
import { connectSocket } from "./socket";

// Imperative bridge between the socket and the three.js scene. The canvas owns
// the meshes; this just turns presence events into add/remove/snapshot calls.
// Returns a disconnect function for cleanup on unmount.
export interface RoomCallbacks {
  onSnapshot: (entities: Entity[]) => void; // full occupant list on join (incl. self)
  onJoined: (entity: Entity) => void;
  onLeft: (id: string) => void;
}

export function connectRoom(cb: RoomCallbacks): () => void {
  const socket = connectSocket(); // dev mode: no Privy token yet
  socket.on("roomState", ({ entities }) => cb.onSnapshot(entities));
  socket.on("entityJoined", ({ entity }) => cb.onJoined(entity));
  socket.on("entityLeft", ({ id }) => cb.onLeft(id));
  return () => socket.disconnect();
}
