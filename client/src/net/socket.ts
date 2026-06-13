import { io, Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient } from "shared/protocol";

export type AppSocket = Socket<ServerToClient, ClientToServer>;

// privyToken is sent via the handshake (see overview "Authentication seam").
// Optional so S2 can run in dev mode before S3's auth middleware exists.
export function connectSocket(privyToken?: string): AppSocket {
  const url = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:8787";
  return io(url, { auth: privyToken ? { privyToken } : {} });
}
