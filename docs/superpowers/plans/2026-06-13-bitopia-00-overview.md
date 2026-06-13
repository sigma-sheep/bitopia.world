# bitopia.world — Implementation Plan Overview & Seams

> **For agentic workers:** This is the index for a multi-stream build. Each stream has its own plan file and is executed in its own **git worktree**. Use superpowers:using-git-worktrees to create each worktree, and superpowers:subagent-driven-development (or executing-plans) to implement each stream's tasks. The **Seams** section below is the frozen interface contract — every stream binds to it and MUST NOT change it without coordinating through the human (solo dev).

**Goal:** Build the bitopia.world hackathon MVP (see `docs/superpowers/specs/2026-06-13-bitopia-hackathon-mvp-design.md`) as parallel, independently-testable streams that merge cleanly.

**Architecture:** Hybrid — Vite+React+Three.js client, always-on Node+socket.io server (also hosts agents + their Privy server wallets), and Sepolia contracts ($BTPA, BitopiaCore) + ENS subnames. Walking/presence/chat/agent-decisions are off-chain; only identity and value are onchain.

**Tech Stack:** TypeScript everywhere · Vite + React + Three.js · socket.io · better-sqlite3 · Hardhat + viem · Privy (embedded + server wallets) · ENS (NameWrapper subnames, Sepolia) · Blink (USDC deposit) · Anthropic SDK (Claude Haiku 4.5).

---

## Stream map & execution waves

| Stream | Plan file | Worktree branch | Depends on | Owns (files only it touches) |
|--------|-----------|-----------------|-----------|------------------------------|
| **S0 Foundation** | `…-01-foundation.md` | `main` (base) | — | `/shared`, scaffold of `/client` `/server` `/contracts`, root config |
| **S1 Contracts** | `…-02-contracts.md` | `s1-contracts` | S0 | `/contracts/**` |
| **S2 Realtime+Render** | `…-03-realtime-render.md` | `s2-realtime` | S0 | `server/src/world/**`, `client/src/render/**` |
| **S3 Identity/Wallets/ENS** | `…-04-identity.md` | `s3-identity` | S0 | `server/src/auth/**`, `server/src/chain/**`, `client/src/wallet/**` |
| **S4 Agent brain** | `…-05-agent-brain.md` | `s4-agents` | S2 model, S1 ABI, S3 wallet | `server/src/agents/**` |
| **S6 Integration** | `…-06-integration.md` | `main` (you) | all | wiring, end-to-end, demo |

**Waves:** S0 (sequential) → **S1, S2, S3 in parallel** → S4 → S6 (sequential).
**Merge order (least-conflict first):** S1 → S2 → S3 → S4. S4 develops against mocks (see its plan) so it never blocks on S1/S3.

## Worktree workflow (solo dev, parallel agents)

1. Complete **S0 on `main`** and commit. This is the base every stream branches from.
2. For each parallel stream, create a worktree off `main`:
   ```bash
   git worktree add ../bitopia-s1 -b s1-contracts
   git worktree add ../bitopia-s2 -b s2-realtime
   git worktree add ../bitopia-s3 -b s3-identity
   ```
   (Run S1/S2/S3 agents concurrently — 3 is the max to meaningfully review.)
3. Each agent runs `npm install` in its worktree, executes its plan, commits frequently.
4. Merge in order S1→S2→S3 into `main`; resolve the only expected conflict: each stream adds one line to `server/src/index.ts` and `client/src/main.tsx` (the registration calls).
5. Create `s4-agents` worktree off the merged `main`; run S4; merge.
6. Do **S6 integration** on `main`.

## Repository layout (created by S0)

```
/contracts                 Hardhat project (S1)
  contracts/BTPA.sol
  contracts/BitopiaCore.sol
  test/…
  scripts/deploy.ts
  deployments/sepolia.json  ← S1 publishes addresses here (consumed by server+client)
/server
  src/
    index.ts                composition root; calls register* funcs
    config.ts               env loading
    db/
      schema.sql
      db.ts                 better-sqlite3 handle + migrations
    world/                  (S2) registerWorld(io)
    auth/                   (S3) registerAuth(io, app)
    chain/                  (S3) registerChain(io, app)  ens, wallets, activity feed
    agents/                 (S4) registerAgents(io)
/client
  src/
    main.tsx                mounts <App/>
    App.tsx                 shell; mounts render canvas + UI panels
    render/                 (S2) Three.js scene, rooms, avatars, movement
    wallet/                 (S3) Privy provider, deposit/convert, activity panel
    ui/                     (S2/S3) chat box, world view, create-agent form
    net/socket.ts           (S0) typed socket.io-client wrapper
/shared
  types.ts                  (S0) domain types — FROZEN
  protocol.ts               (S0) socket event names + payload types — FROZEN
  abi/                      (S1 fills) generated ABIs
package.json (workspaces: client, server, shared, contracts)
```

**Module registration pattern** (keeps parallel streams out of each other's files):
`server/src/index.ts` calls `registerWorld(io)`, `registerAuth(io, app)`, `registerChain(io, app)`, `registerAgents(io)`. Each stream implements its own `register*` in its own dir and adds exactly one import + one call line. Same idea on the client: `App.tsx` mounts `<RenderCanvas/>`, `<WalletPanel/>`, `<ChatBox/>`, etc.

---

## SEAMS (FROZEN INTERFACE CONTRACT)

> Every stream codes against exactly these. Created in S0. Do not change without human coordination.

### `shared/types.ts`

```ts
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
  url: string;           // Sepolia Etherscan link
  label: string;         // human description, e.g. "Golden Flower tipped 1 $BTPA"
  ts: number;
}
```

### `shared/protocol.ts`

```ts
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
```

### Authentication seam (decouples S3 auth from S2 world)

Authentication happens in a **socket.io middleware**, not an event — this is the boundary between S3 (auth) and S2 (world):

- **Client** connects with `io(url, { auth: { privyToken } })`.
- **S3** installs `io.use(authMiddleware)` in `registerAuth`. The middleware verifies the Privy token, creates-or-loads the user + their room, drips gas ETH, ensures the user + room ENS subnames exist, and sets:
  ```ts
  socket.data.user = { id, address, ensName, avatarSeed, roomId } // type SocketUser
  ```
- **S2** `registerWorld` reads `socket.data.user` on the `connection` event to spawn the entity and serve `welcome`. If `socket.data.user` is absent (S3 not merged yet / dev mode), it falls back to a dev identity so S2 is testable alone.

`shared/types.ts` includes the shared shape:
```ts
export interface SocketUser {
  id: string; address: string; ensName?: string; avatarSeed: string; roomId: string;
}
```
And `server/src/socketTypes.ts` (created in S0) augments socket.io's `Socket["data"]`:
```ts
import "socket.io";
import type { SocketUser } from "shared/types";
declare module "socket.io" {
  interface SocketData { user?: SocketUser; }
}
```

### Server-internal event bus seam (decouples S3 create-agent from S4 brain)

`server/src/bus.ts` (created in S0) is a typed in-process EventEmitter:
```ts
import { EventEmitter } from "node:events";
export interface BusEvents { agentCreated: { agentId: string }; }
class Bus extends EventEmitter {
  emitT<K extends keyof BusEvents>(k: K, p: BusEvents[K]) { return this.emit(k, p); }
  onT<K extends keyof BusEvents>(k: K, fn: (p: BusEvents[K]) => void) { this.on(k, fn); }
}
export const bus = new Bus();
```
- **S3** finishes agent creation (Privy server wallet created, `createAgent` tx mined, ENS set, row written to `agents`) → `bus.emitT("agentCreated", { agentId })`.
- **S4** `registerAgents` loads existing agents from the DB on boot **and** `bus.onT("agentCreated", …)` to spawn newly created agents live.

### `server/db/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- privy user id
  address TEXT NOT NULL,          -- embedded wallet address
  ens_name TEXT,
  avatar_seed TEXT NOT NULL,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  ens_name TEXT,
  width INTEGER NOT NULL DEFAULT 30,
  height INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ens_name TEXT,
  wallet_id TEXT NOT NULL,        -- Privy server wallet id
  wallet_address TEXT NOT NULL,
  personality TEXT NOT NULL,
  story TEXT NOT NULL,
  behavior TEXT NOT NULL,
  room_id TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
```

### Contract interfaces (S1 implements; others consume the ABI + `deployments/sepolia.json`)

```solidity
// BTPA — ERC-20 with controlled mint + burn
interface IBTPA /* is IERC20 */ {
  function mint(address to, uint256 amount) external;   // onlyMinter (BitopiaCore)
  function burn(uint256 amount) external;
  function burnFrom(address from, uint256 amount) external;
}

// BitopiaCore — convert + agent creation
interface IBitopiaCore {
  // pulls `usdcAmount` USDC (6dp) from msg.sender, mints BTPA 1:1 (18dp-normalized)
  function convert(uint256 usdcAmount) external;
  // pulls CREATE_FEE+AGENT_SEED BTPA from msg.sender: burns CREATE_FEE, sends AGENT_SEED to agentWallet
  function createAgent(address agentWallet) external;
  function CREATE_FEE() external view returns (uint256); // 5e18
  function AGENT_SEED() external view returns (uint256); // 5e18
  event Converted(address indexed user, uint256 usdcIn, uint256 btpaOut);
  event AgentFunded(address indexed owner, address indexed agentWallet, uint256 seed);
}
```

`deployments/sepolia.json` shape (S1 writes, S2/S3/S4 read):
```json
{ "chainId": 11155111, "BTPA": "0x…", "BitopiaCore": "0x…", "USDC": "0x…" }
```

### Environment variables (`.env`, documented in S0; each stream uses its subset)

```
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=            # S1 deploy + ENS parent owner + gas-drip treasury
PRIVY_APP_ID=
PRIVY_APP_SECRET=               # server wallets
ANTHROPIC_API_KEY=              # agent brain
ENS_PARENT_NAME=bitopiaworld.eth
ENS_PARENT_OWNER_KEY=           # may equal DEPLOYER_PRIVATE_KEY
BLINK_API_KEY=                  # confirm exact var on day one
VITE_SOCKET_URL=http://localhost:8787
VITE_SEPOLIA_RPC_URL=
VITE_PRIVY_APP_ID=
```

---

## Cross-stream conventions
- **Language:** TypeScript, ESM, `strict: true`.
- **Money units:** USDC = 6 decimals; $BTPA = 18 decimals. `convert` normalizes (1 USDC → 1 $BTPA).
- **Tests:** Vitest for client/server/shared; Hardhat/Foundry for contracts. Every task is TDD where logic exists; scaffold tasks verify via run-and-observe.
- **Commits:** frequent and incremental (hackathon eligibility rule). Conventional prefixes (`feat:`, `test:`, `chore:`).
- **IDs:** use `crypto.randomUUID()` server-side for room/agent/message ids.
- **Don't touch another stream's directory.** If you think a seam must change, stop and flag the human.
