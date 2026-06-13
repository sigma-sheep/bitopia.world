import type { Entity, Room, ChatMessage, Vec2, Facing, TxRecord } from "./types";

// Client → Server
// NOTE: authentication is NOT an event — the client connects with
// `io(url, { auth: { privyToken } })`. See "Authentication seam" below.
export interface ClientToServer {
  enterRoom: (p: { roomId: string }) => void;
  move: (p: { pos: Vec2; facing: Facing }) => void;
  chat: (p: { text: string }) => void;
}

// Server → Client
export interface ServerToClient {
  welcome: (p: { selfId: string; rooms: Room[] }) => void;
  roomState: (p: { roomId: string; entities: Entity[] }) => void;
  entityJoined: (p: { entity: Entity }) => void;
  entityMoved: (p: { id: string; pos: Vec2; facing: Facing }) => void;
  entityLeft: (p: { id: string }) => void;
  chat: (p: { message: ChatMessage }) => void;
  roomList: (p: { rooms: Room[] }) => void;
  tx: (p: { record: TxRecord }) => void;               // onchain activity feed
}

export const SOCKET_EVENTS = [
  "enterRoom", "move", "chat",
  "welcome", "roomState", "entityJoined", "entityMoved",
  "entityLeft", "chat", "roomList", "tx",
] as const;
