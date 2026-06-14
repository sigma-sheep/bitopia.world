export type EntityType = "player" | "agent";
export type Facing = "N" | "S" | "E" | "W";
export interface Vec2 { x: number; y: number; }

export interface Entity {
  id: string;            // userId for players, agentId for agents
  type: EntityType;
  roomId: string;
  pos: Vec2;
  facing: Facing;
  displayName: string;   // ENS name if set, else short address
  ensName?: string;
  avatarSeed: string;    // deterministic avatar source (usually the address)
  address: string;       // wallet address — lets others send funds to this entity
}

export interface Room {
  id: string;
  ownerUserId: string;
  ensName?: string;      // e.g. user1-room.bitopiaworld.eth
  width: number;         // grid units
  height: number;
}

// Identity attached to a socket by the S3 auth middleware (see Authentication seam)
export interface SocketUser {
  id: string;
  address: string;
  ensName?: string;
  avatarSeed: string;
  roomId: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  text: string;
  ts: number;            // epoch ms
}

export interface AgentConfig {
  id: string;
  ownerUserId: string;
  name: string;
  ensName?: string;
  walletAddress: string; // Privy server wallet address
  personality: string;
  story: string;
  behavior: string;      // natural-language rule (off-chain)
  roomId: string;
  avatarSeed: string;
}

// Onchain activity feed item (shown in the UI tx panel)
export interface TxRecord {
  kind: "deposit" | "convert" | "createAgent" | "ensRegister" | "tip";
  hash: string;
  url: string;           // Etherscan link
  label: string;         // human description, e.g. "Golden Flower tipped 1 $BTPA"
  ts: number;
}
