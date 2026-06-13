# S0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-06-13-bitopia-00-overview.md` first — its **Seams** section is the source of truth for the frozen files this plan creates.

**Goal:** Scaffold the monorepo and create the frozen seam files so S1/S2/S3 can run in parallel worktrees against stable interfaces.

**Architecture:** npm workspaces monorepo (`shared`, `server`, `client`, `contracts`). `shared` holds frozen types + socket protocol. `server` boots socket.io + SQLite with empty `register*` stubs. `client` boots Vite+React+Three with a placeholder scene + typed socket wrapper. `contracts` is a Hardhat project that compiles empty contract stubs.

**Tech Stack:** TypeScript (ESM, strict), npm workspaces, socket.io, better-sqlite3, Vite + React + Three.js, Hardhat + viem, Vitest.

**This stream runs sequentially on `main`. When done and merged, create the S1/S2/S3 worktrees from this commit.**

---

### Task 1: Root workspace + tooling

**Files:**
- Create: `package.json` (root), `tsconfig.base.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create root `package.json` with workspaces**

```json
{
  "name": "bitopia",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client", "contracts"],
  "scripts": {
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "build:shared": "npm run build -w shared",
    "test": "npm run test -w shared && npm run test -w server"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals"]
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules
dist
.env
contracts/cache
contracts/artifacts
*.sqlite
```

- [ ] **Step 4: Create `.env.example`** — copy the env block verbatim from the overview's "Environment variables" seam.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json .gitignore .env.example
git commit -m "chore: root workspace + tooling"
```

---

### Task 2: `shared` package (frozen seams)

**Files:**
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/types.ts`, `shared/protocol.ts`, `shared/avatar.ts`, `shared/avatar.test.ts`

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "shared",
  "version": "0.0.0",
  "type": "module",
  "main": "types.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{ "extends": "../tsconfig.base.json", "include": ["*.ts"], "compilerOptions": { "outDir": "dist" } }
```

- [ ] **Step 3: Create `shared/types.ts`** — copy verbatim from the overview Seams `shared/types.ts` block.

- [ ] **Step 4: Create `shared/protocol.ts`** — copy verbatim from the overview Seams `shared/protocol.ts` block.

- [ ] **Step 5: Write the failing test for the deterministic avatar helper** (`shared/avatar.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { avatarSeedToColor } from "./avatar";

describe("avatarSeedToColor", () => {
  it("is deterministic for the same seed", () => {
    expect(avatarSeedToColor("0xabc")).toBe(avatarSeedToColor("0xabc"));
  });
  it("returns a 6-digit hex color", () => {
    expect(avatarSeedToColor("0xabc")).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("differs for different seeds", () => {
    expect(avatarSeedToColor("0xabc")).not.toBe(avatarSeedToColor("0xdef"));
  });
});
```

- [ ] **Step 6: Run it; expect FAIL** (`avatarSeedToColor` not defined)

Run: `npm test -w shared`
Expected: FAIL — cannot find `./avatar`.

- [ ] **Step 7: Implement `shared/avatar.ts`**

```ts
// Deterministic avatar color from a seed (address). Used by both client + server.
export function avatarSeedToColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hex = (h & 0xffffff).toString(16).padStart(6, "0");
  return `#${hex}`;
}
```

- [ ] **Step 8: Run it; expect PASS**

Run: `npm test -w shared`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add shared
git commit -m "feat(shared): frozen types, socket protocol, avatar helper"
```

---

### Task 3: `server` scaffold (boots, db init, empty register stubs)

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/config.ts`, `server/src/db/schema.sql`, `server/src/db/db.ts`, `server/src/db/db.test.ts`, `server/src/index.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "socket.io": "^4.7.0",
    "shared": "*"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^4.17.0",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{ "extends": "../tsconfig.base.json", "include": ["src/**/*.ts"] }
```

- [ ] **Step 3: Create `server/src/config.ts`**

```ts
import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? "bitopia.sqlite",
  sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? "",
  deployerKey: process.env.DEPLOYER_PRIVATE_KEY ?? "",
  privyAppId: process.env.PRIVY_APP_ID ?? "",
  privyAppSecret: process.env.PRIVY_APP_SECRET ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  ensParentName: process.env.ENS_PARENT_NAME ?? "bitopiaworld.eth",
  ensParentOwnerKey: process.env.ENS_PARENT_OWNER_KEY ?? "",
};
```

- [ ] **Step 4: Create `server/src/db/schema.sql`** — copy verbatim from the overview Seams `server/db/schema.sql` block.

- [ ] **Step 5: Write failing test `server/src/db/db.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "./db";

describe("openDb", () => {
  it("creates all tables", () => {
    const db = openDb(":memory:");
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    for (const t of ["users", "rooms", "agents", "messages"]) {
      expect(names).toContain(t);
    }
  });
});
```

- [ ] **Step 6: Run it; expect FAIL** (`./db` missing)

Run: `npm test -w server`
Expected: FAIL.

- [ ] **Step 7: Implement `server/src/db/db.ts`**

```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return db;
}
```

- [ ] **Step 8: Run it; expect PASS**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 9: Create `server/src/index.ts` (composition root with empty stubs)**

```ts
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { openDb } from "./db/db.js";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

export const db = openDb(config.dbPath);

// Streams add their register* calls below (one line each — predictable merge point).
// registerWorld(io, db);      // S2
// registerAuth(io, app, db);  // S3
// registerChain(io, app, db); // S3
// registerAgents(io, db);     // S4

httpServer.listen(config.port, () => {
  console.log(`bitopia server on :${config.port}`);
});
```

- [ ] **Step 10: Verify it boots**

Run: `npm install && npm run dev:server` then in another shell `curl localhost:8787/health`
Expected: `{"ok":true}` and a `bitopia.sqlite` file created.

- [ ] **Step 11: Commit**

```bash
git add server
git commit -m "feat(server): scaffold socket.io + sqlite + register stubs"
```

---

### Task 4: `client` scaffold (Vite+React+Three, shell, typed socket)

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/net/socket.ts`

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "client",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "three": "^0.169.0",
    "socket.io-client": "^4.7.0",
    "shared": "*"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.169.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `client/tsconfig.json`**

```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"] }, "include": ["src"] }
```

- [ ] **Step 3: Create `client/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 4: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>bitopia.world</title>
    <style>html,body,#root{margin:0;height:100%;background:#11151c;overflow:hidden}</style>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 5: Create `client/src/net/socket.ts` (typed socket.io-client wrapper)**

```ts
import { io, Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient } from "shared/protocol";

export type AppSocket = Socket<ServerToClient, ClientToServer>;

export function connectSocket(): AppSocket {
  const url = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:8787";
  return io(url, { autoConnect: true });
}
```

- [ ] **Step 6: Create `client/src/App.tsx` (shell — streams mount panels here)**

```tsx
export default function App() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* <RenderCanvas/>  S2 */}
      {/* <ChatBox/>       S2 */}
      {/* <WorldView/>     S2 */}
      {/* <WalletPanel/>   S3 */}
      {/* <TxFeed/>        S3 */}
      <div style={{ color: "#9fb", padding: 16 }}>bitopia.world — scaffold OK</div>
    </div>
  );
}
```

- [ ] **Step 7: Create `client/src/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 8: Verify it boots**

Run: `npm run dev:client`
Expected: page shows "bitopia.world — scaffold OK"; no console errors.

- [ ] **Step 9: Commit**

```bash
git add client
git commit -m "feat(client): scaffold vite+react+three shell + typed socket"
```

---

### Task 5: `contracts` scaffold (Hardhat, compiling stubs, deployments dir)

**Files:**
- Create: `contracts/package.json`, `contracts/hardhat.config.ts`, `contracts/contracts/BTPA.sol`, `contracts/contracts/BitopiaCore.sol`, `contracts/deployments/.gitkeep`

- [ ] **Step 1: Create `contracts/package.json`**

```json
{
  "name": "contracts",
  "version": "0.0.0",
  "scripts": {
    "build": "hardhat compile",
    "test": "hardhat test",
    "deploy:sepolia": "hardhat run scripts/deploy.ts --network sepolia"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox-viem": "^3.0.0",
    "@openzeppelin/contracts": "^5.0.0",
    "hardhat": "^2.22.0"
  }
}
```

- [ ] **Step 2: Create `contracts/hardhat.config.ts`**

```ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
export default config;
```

- [ ] **Step 3: Create stub `contracts/contracts/BTPA.sol` (compiles; S1 fleshes out)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BTPA is ERC20 {
    constructor() ERC20("Bitopia Token", "BTPA") {}
}
```

- [ ] **Step 4: Create stub `contracts/contracts/BitopiaCore.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BitopiaCore {
    uint256 public constant CREATE_FEE = 5e18;
    uint256 public constant AGENT_SEED = 5e18;
}
```

- [ ] **Step 5: Create `contracts/deployments/.gitkeep`** (empty file).

- [ ] **Step 6: Verify it compiles**

Run: `cd contracts && npm install && npm run build`
Expected: "Compiled N Solidity files successfully".

- [ ] **Step 7: Commit**

```bash
git add contracts
git commit -m "chore(contracts): hardhat scaffold + compiling stubs"
```

---

### Task 6: Final verification + base ready

- [ ] **Step 1: Install all + run the workspace test**

Run: `npm install && npm test`
Expected: shared + server tests PASS.

- [ ] **Step 2: Confirm server + client both boot** (Task 3 Step 10, Task 4 Step 8) — quick re-check.

- [ ] **Step 3: Tag the base for worktrees**

```bash
git tag s0-foundation
```

- [ ] **Step 4: Create the parallel worktrees (per overview)**

```bash
git worktree add ../bitopia-s1 -b s1-contracts
git worktree add ../bitopia-s2 -b s2-realtime
git worktree add ../bitopia-s3 -b s3-identity
```

S1/S2/S3 can now proceed in parallel.

---

## Self-review notes
- **Seam coverage:** `shared/types.ts`, `shared/protocol.ts`, `schema.sql`, env, contract stubs all created → unblocks S1/S2/S3/S4.
- **Type consistency:** `openDb(path)` (Task 3) is the handle other streams import; `connectSocket()` returns `AppSocket` typed by the frozen protocol; `avatarSeedToColor` shared by client+server.
- **No placeholders:** every file has full content or an explicit "copy verbatim from overview" pointer to the single source of truth (avoids seam drift).
