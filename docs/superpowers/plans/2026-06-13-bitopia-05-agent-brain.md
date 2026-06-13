# S4 Agent Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`. Read `2026-06-13-bitopia-00-overview.md` first — Seams are frozen. Work in the `s4-agents` git worktree (off the MERGED main after S1/S2/S3).

**Goal:** Implement the autonomous agent brain — a two-speed per-agent loop that (1) roams the world on a fast rule-based tick and (2) on nearby player chat, uses Claude (Haiku 4.5, tool-use) to evaluate the owner's natural-language behavior rule and, when matched, sends a real $BTPA tip via the agent's Privy server wallet and speaks its line. The entire stream is built against injected mocks (WorldApi, AgentWalletOps, Anthropic client, bus) so it is fully unit-tested standalone, then bound to the real singletons only inside `registerAgents`.

**Architecture:** Owns ONLY `server/src/agents/**` plus one registration line in `server/src/index.ts`. Pure logic (movement, prompt building, decision/dispatch) lives in directly-callable, deterministic functions; timers only *drive* those functions. Consumes the frozen seams: `worldApi: WorldApi` (S2), `agentWalletOps: AgentWalletOps` (S3), `bus` (S0), `AgentConfig`/`Entity`/`Vec2`/`Facing`/`ChatMessage`/`TxRecord` (shared, S0), and `deployments/sepolia.json` (S1) for the `BTPA` address. The brain receives nearby player chat by attaching its **own** per-socket `chat` listener inside `registerAgents` (chosen integration touch-point — see Task 7), so it never edits S2's world files.

**Tech Stack:** TypeScript (ESM, strict), Anthropic SDK (`@anthropic-ai/sdk`, Claude Haiku 4.5 `claude-haiku-4-5-20251001`, tool-use), Vitest.

---

### Two-speed loop & Claude tool-use (how it works)

- **Fast tick (~1s, rule-based, free):** a `setInterval` per agent calls the pure `stepToward(pos, goal)` to advance one grid step toward the current goal, then `world.moveEntity`. When the goal is reached (or after enough idle ticks), `pickGoal(roomIds, currentRoomId, rng)` chooses a new goal — sometimes a tile in the current room, sometimes a roam to the other room. All movement math is pure and deterministic via an injected RNG.
- **Slow think (event-driven, throttled, Claude):** when a player in the agent's room sends a chat message, `handlePlayerMessage` is invoked. It checks a per-player cooldown (`lastTipByPlayer`), then calls `evaluateBehavior(anthropic, agent, text)`, which prompts Claude Haiku 4.5 with a system prompt built from the agent's personality + story + behavior and exactly one tool, `reward({ shouldReward, sayText, amountBtpa })`, forced via `tool_choice`. Claude returns a structured `tool_use` block. If `shouldReward` is true and amount is within bounds, the brain calls `wallet.sendErc20(agent.walletId, BTPA, playerAddress, amount*1e18)`, then `world.emitChat` (the agent speaks `sayText`) and `world.emitTx` (a `tip` activity-feed item with the real Sepolia tx hash + Etherscan link). Guardrails: per-player cooldown and amount clamping; the wallet itself enforces "spend only own balance".

---

### Task 1: Agent runtime types + scaffold

**Files:**
- Create: `server/src/agents/types.ts`

- [ ] **Step 1: Create `server/src/agents/types.ts`**

```ts
import type { AgentConfig, Vec2, Facing } from "shared/types";

// Live, mutable per-agent state layered on top of the frozen AgentConfig.
export interface AgentRuntime {
  config: AgentConfig;
  pos: Vec2;
  facing: Facing;
  goal: Vec2 | null;            // current movement target tile
  goalRoomId: string;           // room the agent is heading toward / currently in
  idleTicks: number;            // ticks since last goal change (for re-roam)
  shortMemory: string[];        // recent observations/utterances (capped)
  // simple anti-spam: playerId/address -> epoch ms of last tip
  lastTipByPlayer: Map<string, number>;
}

// The structured result Claude returns via the `reward` tool.
export interface BehaviorResult {
  shouldReward: boolean;
  sayText: string;
  amountBtpa: number;
}

// Tuning constants (kept here so tests + impl share one source).
export const AGENT_TICK_MS = 1000;          // fast-tick interval
export const REROAM_AFTER_IDLE_TICKS = 6;   // pick a new goal if idle this long
export const ROAM_OTHER_ROOM_CHANCE = 0.35; // chance pickGoal roams to the other room
export const TIP_COOLDOWN_MS = 30_000;      // per-player anti-spam window
export const MAX_TIP_BTPA = 5;              // hard upper bound on a single tip
```

- [ ] **Step 2: Commit**

```bash
git add server/src/agents/types.ts
git commit -m "feat(agents): AgentRuntime + BehaviorResult types and tuning constants"
```

---

### Task 2: Pure movement (`pickGoal`, `stepToward`) — TDD

**Files:**
- Create: `server/src/agents/movement.test.ts`, `server/src/agents/movement.ts`

- [ ] **Step 1: Write the failing test `server/src/agents/movement.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { pickGoal, stepToward, type Rng } from "./movement";

// Deterministic RNG: returns the queued values in order, then repeats the last.
function fakeRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

const ROOMS = ["roomA", "roomB"];
const W = 30;
const H = 30;

describe("pickGoal", () => {
  it("stays in the current room when the roam roll is high", () => {
    // first rng() = 0.9 (>= ROAM_OTHER_ROOM_CHANCE) -> stay; next two pick x,y
    const rng = fakeRng([0.9, 0.5, 0.5]);
    const g = pickGoal(ROOMS, "roomA", rng, W, H);
    expect(g.roomId).toBe("roomA");
    expect(g.pos.x).toBeGreaterThanOrEqual(0);
    expect(g.pos.x).toBeLessThan(W);
    expect(g.pos.y).toBeGreaterThanOrEqual(0);
    expect(g.pos.y).toBeLessThan(H);
  });

  it("roams to the other room when the roam roll is low", () => {
    const rng = fakeRng([0.01, 0.5, 0.5]);
    const g = pickGoal(ROOMS, "roomA", rng, W, H);
    expect(g.roomId).toBe("roomB");
  });

  it("produces an integer tile within bounds", () => {
    const rng = fakeRng([0.9, 0.999999, 0.999999]);
    const g = pickGoal(ROOMS, "roomA", rng, W, H);
    expect(Number.isInteger(g.pos.x)).toBe(true);
    expect(Number.isInteger(g.pos.y)).toBe(true);
    expect(g.pos.x).toBe(W - 1);
    expect(g.pos.y).toBe(H - 1);
  });

  it("falls back to the current room when there is only one room", () => {
    const rng = fakeRng([0.01, 0.5, 0.5]);
    const g = pickGoal(["roomA"], "roomA", rng, W, H);
    expect(g.roomId).toBe("roomA");
  });
});

describe("stepToward", () => {
  it("moves one tile toward the goal on the larger axis", () => {
    const { pos, facing } = stepToward({ x: 0, y: 0 }, { x: 5, y: 2 }, W, H);
    expect(pos).toEqual({ x: 1, y: 0 });
    expect(facing).toBe("E");
  });

  it("moves vertically when dy dominates", () => {
    const { pos, facing } = stepToward({ x: 0, y: 0 }, { x: 1, y: 5 }, W, H);
    expect(pos).toEqual({ x: 0, y: 1 });
    expect(facing).toBe("S");
  });

  it("faces W when moving left and N when moving up", () => {
    expect(stepToward({ x: 5, y: 5 }, { x: 0, y: 5 }, W, H).facing).toBe("W");
    expect(stepToward({ x: 5, y: 5 }, { x: 5, y: 0 }, W, H).facing).toBe("N");
  });

  it("does not overshoot or move when already at the goal", () => {
    const { pos } = stepToward({ x: 3, y: 3 }, { x: 3, y: 3 }, W, H);
    expect(pos).toEqual({ x: 3, y: 3 });
  });

  it("clamps to bounds and never produces a negative coordinate", () => {
    const { pos } = stepToward({ x: 0, y: 0 }, { x: -5, y: -5 }, W, H);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `npm test -w server -- movement`
Expected: FAIL — cannot find `./movement`.

- [ ] **Step 3: Implement `server/src/agents/movement.ts`**

```ts
import type { Vec2, Facing } from "shared/types";
import { ROAM_OTHER_ROOM_CHANCE } from "./types";

// Injected RNG so movement is deterministic in tests. Returns [0, 1).
export type Rng = () => number;

export interface Goal {
  roomId: string;
  pos: Vec2;
}

function clampInt(v: number, max: number): number {
  const n = Math.floor(v);
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

// Choose the next goal. Sometimes roam to the OTHER room (if one exists),
// otherwise pick a random tile in the current room.
export function pickGoal(
  roomIds: string[],
  currentRoomId: string,
  rng: Rng,
  width: number,
  height: number,
): Goal {
  const others = roomIds.filter((r) => r !== currentRoomId);
  const roamRoll = rng();
  let roomId = currentRoomId;
  if (others.length > 0 && roamRoll < ROAM_OTHER_ROOM_CHANCE) {
    roomId = others[clampInt(rng() * others.length, others.length - 1)];
    // re-roll the position rolls below; consume one rng for room selection only
    // when we actually roamed. The next two rng() are the x/y tile.
    const x = clampInt(rng() * width, width - 1);
    const y = clampInt(rng() * height, height - 1);
    return { roomId, pos: { x, y } };
  }
  const x = clampInt(rng() * width, width - 1);
  const y = clampInt(rng() * height, height - 1);
  return { roomId, pos: { x, y } };
}

// One tick of grid steering toward `goal`, bounds-clamped. Moves along the
// dominant axis by a single tile. Returns the new pos + the facing it implies.
export function stepToward(
  pos: Vec2,
  goal: Vec2,
  width: number,
  height: number,
): { pos: Vec2; facing: Facing } {
  const dx = goal.x - pos.x;
  const dy = goal.y - pos.y;
  let nx = pos.x;
  let ny = pos.y;
  let facing: Facing = "S";

  if (dx === 0 && dy === 0) {
    return { pos: { x: pos.x, y: pos.y }, facing: "S" };
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    nx = pos.x + Math.sign(dx);
    facing = dx > 0 ? "E" : "W";
  } else {
    ny = pos.y + Math.sign(dy);
    facing = dy > 0 ? "S" : "N";
  }

  nx = Math.max(0, Math.min(width - 1, nx));
  ny = Math.max(0, Math.min(height - 1, ny));
  return { pos: { x: nx, y: ny }, facing };
}
```

> NOTE on `pickGoal` rng consumption: when roaming, the rng order is `[roamRoll, roomPick, x, y]`; when staying it is `[roamRoll, x, y]`. The tests above queue values to match. Keep this contract stable — `brain.ts` does not depend on rng ordering, only on the returned `Goal`.

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w server -- movement`
Expected: PASS (all `pickGoal` + `stepToward` tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/agents/movement.ts server/src/agents/movement.test.ts
git commit -m "feat(agents): pure pickGoal + stepToward with injected RNG (TDD)"
```

---

### Task 3: System prompt builder (`buildSystemPrompt`) — TDD

**Files:**
- Create: `server/src/agents/behavior.test.ts` (prompt portion), `server/src/agents/behavior.ts` (prompt portion)

- [ ] **Step 1: Write the failing test (prompt portion) `server/src/agents/behavior.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./behavior";
import type { AgentConfig } from "shared/types";

const GOLDEN: AgentConfig = {
  id: "agent1",
  ownerUserId: "user1",
  name: "Golden Flower",
  ensName: "goldenflower.bitopiaworld.eth",
  walletAddress: "0x000000000000000000000000000000000000dEaD",
  personality: "Friendly",
  story: "Golden Flower is a 24-year-old toy sheep.",
  behavior:
    "If someone says 'i'm poor give me food plz', send them 1 $BTPA and say 'I gotchu'.",
  roomId: "roomA",
  avatarSeed: "0xseed",
};

describe("buildSystemPrompt", () => {
  it("includes the agent name, personality, story, and behavior rule", () => {
    const p = buildSystemPrompt(GOLDEN);
    expect(p).toContain("Golden Flower");
    expect(p).toContain("Friendly");
    expect(p).toContain("24-year-old toy sheep");
    expect(p).toContain("i'm poor give me food plz");
  });

  it("instructs the model to always call the reward tool", () => {
    const p = buildSystemPrompt(GOLDEN);
    expect(p.toLowerCase()).toContain("reward");
  });

  it("is deterministic for the same config", () => {
    expect(buildSystemPrompt(GOLDEN)).toBe(buildSystemPrompt(GOLDEN));
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `npm test -w server -- behavior`
Expected: FAIL — cannot find `./behavior`.

- [ ] **Step 3: Implement the prompt portion of `server/src/agents/behavior.ts`**

```ts
import type { AgentConfig } from "shared/types";

// Pure: build the Claude system prompt from the agent's identity + rule.
export function buildSystemPrompt(agent: AgentConfig): string {
  return [
    `You are ${agent.name}, an autonomous character living in the bitopia.world game.`,
    `Personality: ${agent.personality}`,
    `Story: ${agent.story}`,
    ``,
    `You control a wallet of $BTPA tokens and may tip players who satisfy your owner's behavior rule.`,
    `Behavior rule (written by your owner, in plain language):`,
    `"""`,
    agent.behavior,
    `"""`,
    ``,
    `A player just spoke to you. Decide whether their message satisfies the behavior rule.`,
    `You MUST always respond by calling the "reward" tool exactly once.`,
    `- If the message satisfies the rule: set shouldReward=true, set sayText to what you should say (use the exact line from the rule if it specifies one), and set amountBtpa to the number of $BTPA the rule specifies.`,
    `- If it does NOT satisfy the rule: set shouldReward=false, set amountBtpa=0, and set sayText to a short in-character reply (or an empty string if you would stay silent).`,
    `Never tip more than the rule allows. Interpret the rule flexibly by meaning, not exact wording.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w server -- behavior`
Expected: PASS (3 `buildSystemPrompt` tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/agents/behavior.ts server/src/agents/behavior.test.ts
git commit -m "feat(agents): buildSystemPrompt pure helper (TDD)"
```

---

### Task 4: `evaluateBehavior` with injected Anthropic client + tool-use — TDD

**Files:**
- Edit: `server/src/agents/behavior.test.ts` (add evaluate cases), `server/src/agents/behavior.ts` (add tool + evaluate)
- Add dependency: `@anthropic-ai/sdk` (types only needed for the client param)

- [ ] **Step 1: Add the Anthropic SDK dependency to `server/package.json`**

Add to `dependencies`:
```json
"@anthropic-ai/sdk": "^0.40.0"
```
Then run: `npm install`

- [ ] **Step 2: Append the failing evaluate tests to `server/src/agents/behavior.test.ts`**

```ts
import { evaluateBehavior, REWARD_TOOL, type AnthropicLike } from "./behavior";

// Build a fake Anthropic client whose messages.create returns a canned response
// containing a single tool_use block for the `reward` tool.
function fakeAnthropic(input: {
  shouldReward: boolean;
  sayText: string;
  amountBtpa: number;
}): AnthropicLike {
  return {
    messages: {
      create: async () => ({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_test",
            name: "reward",
            input,
          },
        ],
      }),
    },
  };
}

// A fake that returns NO tool_use block (model declined to call the tool).
const fakeAnthropicNoTool: AnthropicLike = {
  messages: {
    create: async () => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "hmm" }],
    }),
  },
};

describe("REWARD_TOOL", () => {
  it("declares the reward tool with the three required fields", () => {
    expect(REWARD_TOOL.name).toBe("reward");
    const props = REWARD_TOOL.input_schema.properties;
    expect(props).toHaveProperty("shouldReward");
    expect(props).toHaveProperty("sayText");
    expect(props).toHaveProperty("amountBtpa");
    expect(REWARD_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["shouldReward", "sayText", "amountBtpa"]),
    );
  });
});

describe("evaluateBehavior", () => {
  it("Golden Flower positive case: rewards 1 $BTPA with 'I gotchu'", async () => {
    const client = fakeAnthropic({
      shouldReward: true,
      sayText: "I gotchu",
      amountBtpa: 1,
    });
    const result = await evaluateBehavior(
      client,
      GOLDEN,
      "i'm poor give me food plz",
    );
    expect(result.shouldReward).toBe(true);
    expect(result.sayText).toBe("I gotchu");
    expect(result.amountBtpa).toBe(1);
  });

  it("negative case: unrelated message does not reward", async () => {
    const client = fakeAnthropic({
      shouldReward: false,
      sayText: "",
      amountBtpa: 0,
    });
    const result = await evaluateBehavior(client, GOLDEN, "nice weather today");
    expect(result.shouldReward).toBe(false);
    expect(result.amountBtpa).toBe(0);
  });

  it("defaults to no-reward when the model returns no tool_use block", async () => {
    const result = await evaluateBehavior(
      fakeAnthropicNoTool,
      GOLDEN,
      "anything",
    );
    expect(result.shouldReward).toBe(false);
    expect(result.amountBtpa).toBe(0);
    expect(result.sayText).toBe("");
  });

  it("calls the model with the Haiku 4.5 id, the tool, and forced tool_choice", async () => {
    let captured: any;
    const client: AnthropicLike = {
      messages: {
        create: async (args: any) => {
          captured = args;
          return {
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "reward",
                input: { shouldReward: false, sayText: "", amountBtpa: 0 },
              },
            ],
          };
        },
      },
    };
    await evaluateBehavior(client, GOLDEN, "hi");
    expect(captured.model).toBe("claude-haiku-4-5-20251001");
    expect(captured.tools[0].name).toBe("reward");
    expect(captured.tool_choice).toEqual({ type: "tool", name: "reward" });
    expect(captured.system).toContain("Golden Flower");
    expect(captured.messages[0].content).toContain("i'm poor".slice(0, 0) + "hi");
  });
});
```

- [ ] **Step 3: Run it; expect FAIL**

Run: `npm test -w server -- behavior`
Expected: FAIL — `evaluateBehavior`, `REWARD_TOOL`, `AnthropicLike` not exported.

- [ ] **Step 4: Append the tool + `evaluateBehavior` implementation to `server/src/agents/behavior.ts`**

```ts
import type { BehaviorResult } from "./types";

// Minimal structural type for the Anthropic client so tests can inject a fake.
// Matches the shape of `new Anthropic().messages.create(...)`.
export interface AnthropicLike {
  messages: {
    create: (args: any) => Promise<{ content: any[] } & Record<string, unknown>>;
  };
}

export const REWARD_TOOL = {
  name: "reward",
  description:
    "Record your decision about whether to tip the player $BTPA and what to say to them.",
  input_schema: {
    type: "object" as const,
    properties: {
      shouldReward: {
        type: "boolean",
        description: "True only if the player's message satisfies the behavior rule.",
      },
      sayText: {
        type: "string",
        description:
          "What the agent says to the player. Use the exact line from the rule when it specifies one; empty string to stay silent.",
      },
      amountBtpa: {
        type: "number",
        description:
          "How many $BTPA to send. The amount the rule specifies, or 0 when not rewarding.",
      },
    },
    required: ["shouldReward", "sayText", "amountBtpa"],
  },
} as const;

const MODEL_ID = "claude-haiku-4-5-20251001";

// Call Claude (Haiku 4.5) with tool-use to evaluate one player message against
// the agent's behavior rule. Returns the structured reward decision.
export async function evaluateBehavior(
  client: AnthropicLike,
  agent: AgentConfig,
  playerMessage: string,
): Promise<BehaviorResult> {
  const resp = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 256,
    system: buildSystemPrompt(agent),
    tools: [REWARD_TOOL],
    tool_choice: { type: "tool", name: "reward" },
    messages: [{ role: "user", content: playerMessage }],
  });

  const block = (resp.content ?? []).find(
    (b: any) => b?.type === "tool_use" && b?.name === "reward",
  );

  if (!block || typeof block.input !== "object" || block.input === null) {
    return { shouldReward: false, sayText: "", amountBtpa: 0 };
  }

  const input = block.input as Partial<BehaviorResult>;
  return {
    shouldReward: input.shouldReward === true,
    sayText: typeof input.sayText === "string" ? input.sayText : "",
    amountBtpa: typeof input.amountBtpa === "number" ? input.amountBtpa : 0,
  };
}
```

> The `import type { AgentConfig }` at the top of `behavior.ts` from Task 3 already covers the `AgentConfig` usage here.

- [ ] **Step 5: Run it; expect PASS**

Run: `npm test -w server -- behavior`
Expected: PASS (prompt tests + `REWARD_TOOL` + 4 `evaluateBehavior` tests).

- [ ] **Step 6: Commit**

```bash
git add server/package.json package-lock.json server/src/agents/behavior.ts server/src/agents/behavior.test.ts
git commit -m "feat(agents): evaluateBehavior via Claude Haiku 4.5 tool-use (injected client, TDD)"
```

---

### Task 5: Brain decision/dispatch (`handlePlayerMessage`) — TDD with mock world+wallet+anthropic

**Files:**
- Create: `server/src/agents/brain.test.ts`, `server/src/agents/brain.ts`

- [ ] **Step 1: Write the failing test `server/src/agents/brain.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createBrain, type BrainDeps } from "./brain";
import type { AgentRuntime } from "./types";
import type { AgentConfig, Entity, ChatMessage } from "shared/types";

const GOLDEN: AgentConfig = {
  id: "agent1",
  ownerUserId: "user1",
  name: "Golden Flower",
  ensName: "goldenflower.bitopiaworld.eth",
  walletAddress: "0x000000000000000000000000000000000000dEaD",
  personality: "Friendly",
  story: "Golden Flower is a 24-year-old toy sheep.",
  behavior:
    "If someone says 'i'm poor give me food plz', send them 1 $BTPA and say 'I gotchu'.",
  roomId: "roomA",
  avatarSeed: "0xseed",
};

function makeRuntime(): AgentRuntime {
  return {
    config: GOLDEN,
    pos: { x: 5, y: 5 },
    facing: "S",
    goal: null,
    goalRoomId: "roomA",
    idleTicks: 0,
    shortMemory: [],
    lastTipByPlayer: new Map(),
  };
}

const BTPA = "0x1111111111111111111111111111111111111111" as const;

// Mock seams. world.roomEntities returns the agent + sender as needed.
function makeDeps(overrides: Partial<BrainDeps> = {}): BrainDeps {
  return {
    world: {
      addEntity: vi.fn(),
      moveEntity: vi.fn(),
      removeEntity: vi.fn(),
      roomEntities: vi.fn(() => [] as Entity[]),
      emitChat: vi.fn(),
      emitTx: vi.fn(),
    },
    wallet: {
      createAgentWallet: vi.fn(),
      sendErc20: vi.fn(async () => "0xhash"),
      fundEth: vi.fn(async () => {}),
    },
    anthropic: {
      messages: {
        create: async () => ({
          content: [
            {
              type: "tool_use",
              id: "t",
              name: "reward",
              input: { shouldReward: true, sayText: "I gotchu", amountBtpa: 1 },
            },
          ],
        }),
      },
    },
    btpaAddress: BTPA,
    rooms: [
      { id: "roomA", width: 30, height: 30 },
      { id: "roomB", width: 30, height: 30 },
    ],
    now: () => 1_000_000,
    ...overrides,
  };
}

const senderAddr = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function chat(text: string): ChatMessage {
  return {
    id: "m1",
    roomId: "roomA",
    senderId: "user2",
    senderName: "user2.bitopiaworld.eth",
    text,
    ts: 0,
  };
}

describe("brain.handlePlayerMessage", () => {
  it("positive case: sends $BTPA, agent speaks, and a tip tx is emitted", async () => {
    const deps = makeDeps();
    const brain = createBrain(makeRuntime(), deps, () => 0.9);

    await brain.handlePlayerMessage(chat("i'm poor give me food plz"), senderAddr);

    expect(deps.wallet.sendErc20).toHaveBeenCalledWith(
      // walletId comes from runtime.config.walletId — see impl note below
      GOLDEN_WALLET_ID,
      BTPA,
      senderAddr,
      10n ** 18n, // 1 * 1e18
    );
    expect(deps.world.emitChat).toHaveBeenCalledTimes(1);
    const spoken = (deps.world.emitChat as any).mock.calls[0][0] as ChatMessage;
    expect(spoken.senderId).toBe("agent1");
    expect(spoken.text).toBe("I gotchu");
    expect(deps.world.emitTx).toHaveBeenCalledTimes(1);
    const tx = (deps.world.emitTx as any).mock.calls[0][0];
    expect(tx.kind).toBe("tip");
    expect(tx.hash).toBe("0xhash");
    expect(tx.url).toContain("0xhash");
  });

  it("negative case: no reward -> no send, no tip tx", async () => {
    const deps = makeDeps({
      anthropic: {
        messages: {
          create: async () => ({
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "reward",
                input: { shouldReward: false, sayText: "", amountBtpa: 0 },
              },
            ],
          }),
        },
      },
    });
    const brain = createBrain(makeRuntime(), deps, () => 0.9);

    await brain.handlePlayerMessage(chat("hello there"), senderAddr);

    expect(deps.wallet.sendErc20).not.toHaveBeenCalled();
    expect(deps.world.emitTx).not.toHaveBeenCalled();
  });

  it("anti-spam: a second matching message within cooldown does not tip again", async () => {
    const deps = makeDeps();
    const brain = createBrain(makeRuntime(), deps, () => 0.9);

    await brain.handlePlayerMessage(chat("i'm poor give me food plz"), senderAddr);
    await brain.handlePlayerMessage(chat("i'm poor give me food plz"), senderAddr);

    expect(deps.wallet.sendErc20).toHaveBeenCalledTimes(1);
  });

  it("clamps an over-limit amount and never exceeds MAX_TIP_BTPA", async () => {
    const deps = makeDeps({
      anthropic: {
        messages: {
          create: async () => ({
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "reward",
                input: { shouldReward: true, sayText: "ok", amountBtpa: 9999 },
              },
            ],
          }),
        },
      },
    });
    const brain = createBrain(makeRuntime(), deps, () => 0.9);

    await brain.handlePlayerMessage(chat("gimme"), senderAddr);

    const [, , , amount] = (deps.wallet.sendErc20 as any).mock.calls[0];
    expect(amount).toBe(5n * 10n ** 18n); // MAX_TIP_BTPA * 1e18
  });

  it("does not tip when shouldReward is true but amount is <= 0", async () => {
    const deps = makeDeps({
      anthropic: {
        messages: {
          create: async () => ({
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "reward",
                input: { shouldReward: true, sayText: "ok", amountBtpa: 0 },
              },
            ],
          }),
        },
      },
    });
    const brain = createBrain(makeRuntime(), deps, () => 0.9);

    await brain.handlePlayerMessage(chat("gimme"), senderAddr);

    expect(deps.wallet.sendErc20).not.toHaveBeenCalled();
  });
});

describe("brain.fastTick", () => {
  it("picks a goal when none is set then steps toward it via world.moveEntity", () => {
    const deps = makeDeps();
    const rt = makeRuntime();
    const brain = createBrain(rt, deps, () => 0.9); // 0.9 => stay in current room

    brain.fastTick();

    expect(rt.goal).not.toBeNull();
    expect(deps.world.moveEntity).toHaveBeenCalledTimes(1);
    const [id] = (deps.world.moveEntity as any).mock.calls[0];
    expect(id).toBe("agent1");
  });
});
```

> The test references `GOLDEN_WALLET_ID`. Add this constant at the top of the test file: `const GOLDEN_WALLET_ID = "wallet-golden";` and set `walletId` on the runtime config. To do that cleanly, extend the fixture: in `makeRuntime`, use a config that includes a `walletId`. Since `AgentConfig` (frozen) has **no** `walletId` field, the brain reads the Privy server **wallet id** from `AgentRuntime.config`'s sibling — see impl note: we pass `walletId` into `createBrain` via the runtime. **Resolution:** store `walletId` on `AgentRuntime` (add field). Update `types.ts` AgentRuntime to include `walletId: string`, set it in `makeRuntime` to `GOLDEN_WALLET_ID`, and the brain uses `runtime.walletId`.

- [ ] **Step 2: Add `walletId` to `AgentRuntime` in `server/src/agents/types.ts`**

Edit the `AgentRuntime` interface to add (after `config`):
```ts
  walletId: string;             // Privy server wallet id (from the agents table)
```
Update the `makeRuntime` fixture in the test to set `walletId: GOLDEN_WALLET_ID` and add `const GOLDEN_WALLET_ID = "wallet-golden";` near the top of `brain.test.ts`.

- [ ] **Step 3: Run it; expect FAIL**

Run: `npm test -w server -- brain`
Expected: FAIL — cannot find `./brain`.

- [ ] **Step 4: Implement `server/src/agents/brain.ts`**

```ts
import type { Entity, ChatMessage, TxRecord } from "shared/types";
import type { WorldApi } from "../world/index.js";
import type { AgentWalletOps } from "../chain/wallets.js";
import type { AgentRuntime } from "./types";
import {
  REROAM_AFTER_IDLE_TICKS,
  TIP_COOLDOWN_MS,
  MAX_TIP_BTPA,
} from "./types";
import { pickGoal, stepToward, type Rng } from "./movement";
import { evaluateBehavior, type AnthropicLike } from "./behavior";

export interface RoomDims {
  id: string;
  width: number;
  height: number;
}

export interface BrainDeps {
  world: WorldApi;
  wallet: AgentWalletOps;
  anthropic: AnthropicLike;
  btpaAddress: `0x${string}`;
  rooms: RoomDims[];
  now?: () => number;
}

const ETHERSCAN = "https://sepolia.etherscan.io/tx/";

function btpaToWei(amount: number): bigint {
  // amount is a small integer-ish $BTPA value; convert to 18dp wei safely.
  // Use string math to avoid float drift for fractional amounts.
  const [whole, frac = ""] = String(amount).split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded || "0");
}

export function createBrain(
  runtime: AgentRuntime,
  deps: BrainDeps,
  rng: Rng = Math.random,
) {
  const now = deps.now ?? (() => Date.now());
  const roomIds = deps.rooms.map((r) => r.id);

  function dimsFor(roomId: string): RoomDims {
    return (
      deps.rooms.find((r) => r.id === roomId) ?? {
        id: roomId,
        width: 30,
        height: 30,
      }
    );
  }

  // One rule-based movement tick: ensure a goal, step toward it, broadcast.
  function fastTick(): void {
    const dims = dimsFor(runtime.goalRoomId);

    const needGoal =
      runtime.goal === null ||
      runtime.idleTicks >= REROAM_AFTER_IDLE_TICKS ||
      (runtime.goal.x === runtime.pos.x && runtime.goal.y === runtime.pos.y);

    if (needGoal) {
      const g = pickGoal(roomIds, runtime.goalRoomId, rng, dims.width, dims.height);
      runtime.goal = g.pos;
      runtime.goalRoomId = g.roomId;
      runtime.idleTicks = 0;
    }

    const targetDims = dimsFor(runtime.goalRoomId);
    const { pos, facing } = stepToward(
      runtime.pos,
      runtime.goal!,
      targetDims.width,
      targetDims.height,
    );

    const moved = pos.x !== runtime.pos.x || pos.y !== runtime.pos.y;
    runtime.pos = pos;
    runtime.facing = facing;
    runtime.idleTicks = moved ? 0 : runtime.idleTicks + 1;

    deps.world.moveEntity(runtime.config.id, runtime.pos, runtime.facing);
  }

  // Slow think: evaluate one player message; tip + speak when the rule matches.
  async function handlePlayerMessage(
    msg: ChatMessage,
    senderAddress: string,
  ): Promise<void> {
    // Ignore the agent's own messages / messages from other rooms.
    if (msg.senderId === runtime.config.id) return;
    if (msg.roomId !== runtime.config.roomId && msg.roomId !== runtime.goalRoomId) {
      return;
    }

    // Per-player cooldown (anti-spam).
    const last = runtime.lastTipByPlayer.get(senderAddress) ?? 0;
    const t = now();

    const result = await evaluateBehavior(deps.anthropic, runtime.config, msg.text);
    runtime.shortMemory.push(`${msg.senderName}: ${msg.text}`);
    if (runtime.shortMemory.length > 10) runtime.shortMemory.shift();

    if (!result.shouldReward) {
      // Optionally still speak a non-reward reply.
      if (result.sayText) speak(result.sayText);
      return;
    }

    if (t - last < TIP_COOLDOWN_MS) {
      // Within cooldown: do not tip again (guardrail).
      return;
    }

    const amount = Math.min(result.amountBtpa, MAX_TIP_BTPA);
    if (amount <= 0) return;

    const wei = btpaToWei(amount);
    const hash = await deps.wallet.sendErc20(
      runtime.walletId,
      deps.btpaAddress,
      senderAddress as `0x${string}`,
      wei,
    );

    runtime.lastTipByPlayer.set(senderAddress, t);

    if (result.sayText) speak(result.sayText);

    const tx: TxRecord = {
      kind: "tip",
      hash,
      url: `${ETHERSCAN}${hash}`,
      label: `${runtime.config.name} tipped ${amount} $BTPA`,
      ts: t,
    };
    deps.world.emitTx(tx, runtime.config.roomId);
  }

  function speak(text: string): void {
    const out: ChatMessage = {
      id: `${runtime.config.id}-${now()}`,
      roomId: runtime.config.roomId,
      senderId: runtime.config.id,
      senderName: runtime.config.ensName ?? runtime.config.name,
      text,
      ts: now(),
    };
    runtime.shortMemory.push(`${out.senderName}: ${text}`);
    if (runtime.shortMemory.length > 10) runtime.shortMemory.shift();
    deps.world.emitChat(out);
  }

  return { fastTick, handlePlayerMessage, speak, runtime };
}

export type Brain = ReturnType<typeof createBrain>;
```

> Impl notes:
> - `runtime.config.roomId` is the agent's authoritative current room for chat relevance. When roaming across rooms, integration (S6) may sync `config.roomId` to `goalRoomId` on room arrival; for the MVP the agent reacts to chat in either its config room or the room it is heading to.
> - `WorldApi` / `AgentWalletOps` are imported as **types** from S2/S3 dirs. After the merged main exists those paths resolve. If S2/S3 type files are not yet present in the worktree, temporarily define matching local interfaces and swap to the imports at integration — but since this worktree is cut from the MERGED main (after S1/S2/S3), the imports resolve directly.

- [ ] **Step 5: Run it; expect PASS**

Run: `npm test -w server -- brain`
Expected: PASS (5 `handlePlayerMessage` tests + 1 `fastTick` test).

- [ ] **Step 6: Commit**

```bash
git add server/src/agents/brain.ts server/src/agents/brain.test.ts server/src/agents/types.ts
git commit -m "feat(agents): brain decision/dispatch + fastTick (mock world/wallet/anthropic, TDD)"
```

---

### Task 6: `registerAgents` — load agents, spawn, bind real singletons, live spawn via bus

**Files:**
- Create: `server/src/agents/index.ts`, `server/src/agents/index.test.ts`

- [ ] **Step 1: Write the failing test `server/src/agents/index.test.ts`**

This test exercises the pure spawn/registry helpers without real timers, Anthropic, Privy, or sockets. It verifies that agents loaded from a DB row become entities added to the world and get a brain, and that a `bus` event spawns a new one.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnAgentFromRow, type AgentsRuntimeCtx } from "./index";
import type { Entity } from "shared/types";

const ROW = {
  id: "agent1",
  owner_user_id: "user1",
  name: "Golden Flower",
  ens_name: "goldenflower.bitopiaworld.eth",
  wallet_id: "wallet-golden",
  wallet_address: "0x000000000000000000000000000000000000dEaD",
  personality: "Friendly",
  story: "Golden Flower is a 24-year-old toy sheep.",
  behavior: "If someone says 'i'm poor give me food plz', send 1 $BTPA and say 'I gotchu'.",
  room_id: "roomA",
  avatar_seed: "0xseed",
  created_at: 0,
};

function makeCtx(): AgentsRuntimeCtx {
  return {
    world: {
      addEntity: vi.fn(),
      moveEntity: vi.fn(),
      removeEntity: vi.fn(),
      roomEntities: vi.fn(() => [] as Entity[]),
      emitChat: vi.fn(),
      emitTx: vi.fn(),
    },
    wallet: {
      createAgentWallet: vi.fn(),
      sendErc20: vi.fn(async () => "0xhash"),
      fundEth: vi.fn(async () => {}),
    },
    anthropic: { messages: { create: async () => ({ content: [] }) } },
    btpaAddress: "0x1111111111111111111111111111111111111111",
    rooms: [
      { id: "roomA", width: 30, height: 30 },
      { id: "roomB", width: 30, height: 30 },
    ],
    brains: new Map(),
    intervals: new Map(),
  };
}

describe("spawnAgentFromRow", () => {
  let ctx: AgentsRuntimeCtx;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it("adds an agent Entity to the world and registers a brain", () => {
    spawnAgentFromRow(ROW, ctx, { startInterval: false });

    expect(ctx.world.addEntity).toHaveBeenCalledTimes(1);
    const e = (ctx.world.addEntity as any).mock.calls[0][0] as Entity;
    expect(e.id).toBe("agent1");
    expect(e.type).toBe("agent");
    expect(e.roomId).toBe("roomA");
    expect(e.displayName).toBe("goldenflower.bitopiaworld.eth");
    expect(ctx.brains.has("agent1")).toBe(true);
  });

  it("is idempotent: spawning the same agent twice does not double-add", () => {
    spawnAgentFromRow(ROW, ctx, { startInterval: false });
    spawnAgentFromRow(ROW, ctx, { startInterval: false });
    expect(ctx.world.addEntity).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `npm test -w server -- agents/index`
Expected: FAIL — cannot find `./index` exports.

- [ ] **Step 3: Implement `server/src/agents/index.ts`**

```ts
import type { Server } from "socket.io";
import type { Database } from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, Entity, ChatMessage } from "shared/types";
import { bus } from "../bus.js";
import { worldApi } from "../world/index.js";
import { agentWalletOps } from "../chain/wallets.js";
import { config } from "../config.js";
import { createBrain, type Brain, type RoomDims } from "./brain.js";
import type { AnthropicLike } from "./behavior.js";
import type { AgentRuntime } from "./types";
import { AGENT_TICK_MS } from "./types";

// Shape of an `agents` table row (snake_case, per schema.sql).
export interface AgentRow {
  id: string;
  owner_user_id: string;
  name: string;
  ens_name: string | null;
  wallet_id: string;
  wallet_address: string;
  personality: string;
  story: string;
  behavior: string;
  room_id: string;
  avatar_seed: string;
  created_at: number;
}

export interface AgentsRuntimeCtx {
  world: typeof worldApi;
  wallet: typeof agentWalletOps;
  anthropic: AnthropicLike;
  btpaAddress: `0x${string}`;
  rooms: RoomDims[];
  brains: Map<string, Brain>;
  intervals: Map<string, ReturnType<typeof setInterval>>;
}

function rowToConfig(row: AgentRow): AgentConfig {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    ensName: row.ens_name ?? undefined,
    walletAddress: row.wallet_address,
    personality: row.personality,
    story: row.story,
    behavior: row.behavior,
    roomId: row.room_id,
    avatarSeed: row.avatar_seed,
  };
}

function newRuntime(row: AgentRow): AgentRuntime {
  const cfg = rowToConfig(row);
  return {
    config: cfg,
    walletId: row.wallet_id,
    pos: { x: 15, y: 15 },
    facing: "S",
    goal: null,
    goalRoomId: cfg.roomId,
    idleTicks: 0,
    shortMemory: [],
    lastTipByPlayer: new Map(),
  };
}

// Pure-ish spawn: build runtime, add the Entity, create the brain. Optionally
// start the fast-tick interval (off in unit tests).
export function spawnAgentFromRow(
  row: AgentRow,
  ctx: AgentsRuntimeCtx,
  opts: { startInterval: boolean },
): Brain {
  const existing = ctx.brains.get(row.id);
  if (existing) return existing;

  const runtime = newRuntime(row);

  const entity: Entity = {
    id: runtime.config.id,
    type: "agent",
    roomId: runtime.config.roomId,
    pos: runtime.pos,
    facing: runtime.facing,
    displayName: runtime.config.ensName ?? runtime.config.name,
    ensName: runtime.config.ensName,
    avatarSeed: runtime.config.avatarSeed,
  };
  ctx.world.addEntity(entity);

  const brain = createBrain(runtime, {
    world: ctx.world,
    wallet: ctx.wallet,
    anthropic: ctx.anthropic,
    btpaAddress: ctx.btpaAddress,
    rooms: ctx.rooms,
  });
  ctx.brains.set(row.id, brain);

  if (opts.startInterval) {
    const handle = setInterval(() => brain.fastTick(), AGENT_TICK_MS);
    ctx.intervals.set(row.id, handle);
  }

  return brain;
}

// Read the BTPA address from S1's deployments file.
function readBtpaAddress(): `0x${string}` {
  const here = dirname(fileURLToPath(import.meta.url));
  // server/src/agents -> repo root /contracts/deployments/sepolia.json
  const p = join(here, "../../../contracts/deployments/sepolia.json");
  const json = JSON.parse(readFileSync(p, "utf8"));
  return json.BTPA as `0x${string}`;
}

// Composition entry point — called once from server/src/index.ts.
export function registerAgents(io: Server, db: Database): void {
  const ctx: AgentsRuntimeCtx = {
    world: worldApi,
    wallet: agentWalletOps,
    anthropic: new Anthropic({ apiKey: config.anthropicKey }) as unknown as AnthropicLike,
    btpaAddress: readBtpaAddress(),
    rooms: loadRoomDims(db),
    brains: new Map(),
    intervals: new Map(),
  };

  // Boot: spawn every existing agent.
  const rows = db.prepare("SELECT * FROM agents").all() as AgentRow[];
  for (const row of rows) {
    spawnAgentFromRow(row, ctx, { startInterval: true });
  }

  // Live: spawn agents created after boot.
  bus.onT("agentCreated", ({ agentId }) => {
    const row = db
      .prepare("SELECT * FROM agents WHERE id = ?")
      .get(agentId) as AgentRow | undefined;
    if (row) spawnAgentFromRow(row, ctx, { startInterval: true });
  });

  // Chat delivery: attach our OWN per-socket `chat` listener (see plan §7).
  // We do NOT edit S2's world files; we observe the same client event.
  io.on("connection", (socket) => {
    socket.on("chat", (p: { text: string }) => {
      const user = socket.data.user;
      if (!user) return;
      const message: ChatMessage = {
        id: `${user.id}-${Date.now()}`,
        roomId: user.roomId,
        senderId: user.id,
        senderName: user.ensName ?? user.address,
        text: p.text,
        ts: Date.now(),
      };
      for (const brain of ctx.brains.values()) {
        if (brain.runtime.config.roomId === user.roomId) {
          void brain.handlePlayerMessage(message, user.address);
        }
      }
    });
  });
}

function loadRoomDims(db: Database): RoomDims[] {
  const rows = db
    .prepare("SELECT id, width, height FROM rooms")
    .all() as Array<{ id: string; width: number; height: number }>;
  if (rows.length === 0) {
    return [
      { id: "roomA", width: 30, height: 30 },
      { id: "roomB", width: 30, height: 30 },
    ];
  }
  return rows.map((r) => ({ id: r.id, width: r.width, height: r.height }));
}
```

> Note: `ctx.world`/`ctx.wallet` are typed as `typeof worldApi`/`typeof agentWalletOps` so the unit test can pass structurally-compatible mock objects. `registerAgents` itself is exercised only at integration (it touches real sockets/Anthropic/db); the unit test targets `spawnAgentFromRow`, which holds the load-bearing logic.

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w server -- agents/index`
Expected: PASS (2 `spawnAgentFromRow` tests).

- [ ] **Step 5: Run the whole agents suite**

Run: `npm test -w server -- agents`
Expected: PASS (movement + behavior + brain + index).

- [ ] **Step 6: Commit**

```bash
git add server/src/agents/index.ts server/src/agents/index.test.ts
git commit -m "feat(agents): registerAgents — boot-load, live bus spawn, per-socket chat delivery"
```

---

### Task 7: Wire `registerAgents` into the composition root (one line)

**Chat-delivery approach (chosen, justified):** The brain attaches its **own** per-socket listener for the `chat` client event inside `registerAgents` (`io.on("connection")` → `socket.on("chat")`). Justification: it requires **zero edits to S2's world files**, reuses the exact frozen `chat` client→server event from `shared/protocol.ts`, reconstructs the `ChatMessage` from `socket.data.user` (set by S3 auth) the same way S2 does, and dispatches only to brains whose agent shares the sender's room. The alternative (polling the `messages` table) adds latency and DB load and risks reprocessing; the listener is immediate and decoupled. **Single integration touch-point to confirm in S6:** that the agent's `socket.on("chat")` and S2's own `chat` handler coexist (both listen; neither consumes the event), and that `socket.data.user.roomId` is populated by the time chat fires.

**Files:**
- Edit: `server/src/index.ts` (add one import + one call — the predictable merge point)

- [ ] **Step 1: Add the import + call to `server/src/index.ts`**

Add the import near the other `register*` imports:
```ts
import { registerAgents } from "./agents/index.js";
```
And uncomment/replace the S4 stub line in the register block:
```ts
registerAgents(io, db);     // S4
```

> Ordering: `registerAgents` must run **after** `registerWorld` and `registerChain` so `worldApi` and `agentWalletOps` singletons are assigned before agents bind to them. Place the `registerAgents(io, db)` call last in the register block.

- [ ] **Step 2: Type-check + full server test**

Run: `npm test -w server`
Expected: PASS (all server suites including agents).

- [ ] **Step 3: Boot smoke (manual, no real keys needed for compile)**

Run: `npm run build -w shared && npx tsc -p server/tsconfig.json --noEmit`
Expected: no type errors in `server/src/agents/**` or `server/src/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire registerAgents into composition root (S4)"
```

---

### Task 8: Final verification + branch wrap

- [ ] **Step 1: Run the full agents suite once more**

Run: `npm test -w server -- agents`
Expected: PASS — movement (12), behavior (prompt + tool + evaluate), brain (6), index (2).

- [ ] **Step 2: Confirm scope — only S4 files touched**

Run: `git diff --name-only main...HEAD`
Expected: only `server/src/agents/**` and the single-line change in `server/src/index.ts` (+ `server/package.json`/lockfile for the Anthropic SDK dep).

- [ ] **Step 3: Use superpowers:finishing-a-development-branch** to merge `s4-agents` into `main`.

---

## Self-review notes
- **Seam binding:** consumes `WorldApi` (`moveEntity`, `addEntity`, `emitChat`, `emitTx`), `AgentWalletOps` (`sendErc20`), `bus.onT("agentCreated")`, `AgentConfig`/`Entity`/`ChatMessage`/`TxRecord`, and `deployments/sepolia.json` BTPA address — no S2/S3 files edited. Only added line elsewhere is the one `registerAgents(io, db)` call.
- **Testable standalone:** every consumed dependency is injected (`BrainDeps`, `AgentsRuntimeCtx`); real singletons (`worldApi`, `agentWalletOps`, `new Anthropic(...)`) are bound only inside `registerAgents`. Logic lives in `handlePlayerMessage`/`fastTick`/`spawnAgentFromRow`; timers only drive them.
- **Two-speed loop:** fast tick = pure `pickGoal`/`stepToward` → `world.moveEntity`; slow think = `evaluateBehavior` (Claude Haiku 4.5 tool-use, forced `tool_choice`) → guarded `sendErc20` + `emitChat` + `emitTx`.
- **Guardrails:** per-player `TIP_COOLDOWN_MS`, `MAX_TIP_BTPA` clamp, ignore non-positive amounts, ignore own/other-room messages; wallet enforces own-balance-only.
- **No placeholders:** full code + full test bodies (mock Anthropic/world/wallet), exact run commands, expected FAIL→PASS, frequent conventional commits.
