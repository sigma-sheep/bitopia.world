# S1 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-06-13-bitopia-00-overview.md` first — its Seams section is the frozen interface contract. Work in the `s1-contracts` git worktree (branched from the S0 foundation commit).

**Goal:** Flesh out the Sepolia contracts (`MockUSDC`, `BTPA`, `BitopiaCore`) with full TDD so the rest of the build (S2/S3/S4) can consume the deployed addresses + exported ABIs. The deliverable end state: all Hardhat tests pass, a deploy script produces `contracts/deployments/sepolia.json` and exports `shared/abi/{BTPA,BitopiaCore,MockUSDC}.json`.

**Architecture:** Three contracts on Sepolia. `MockUSDC` is a 6-decimal ERC20 with an open `mint` faucet (testnet demo on-ramp — real testnet USDC may not be pullable by Blink, so we ship our own). `BTPA` is the 18-decimal game token (ERC20Burnable) whose `mint` is gated to a single minter — `BitopiaCore`. `BitopiaCore` holds the convert (USDC → BTPA 1:1, normalizing 6→18 decimals) and create-agent (burn `CREATE_FEE` + seed agent wallet with `AGENT_SEED`) logic. Bind exactly to the `IBTPA` / `IBitopiaCore` interfaces frozen in the overview — function names and event signatures MUST match.

**Tech Stack:** Solidity 0.8.24, OpenZeppelin, Hardhat + viem.

---

### Task 0: Worktree setup + dependency check

**Files:**
- (none created — environment prep)

- [ ] **Step 1: Confirm you are in the `s1-contracts` worktree**

Run: `git branch --show-current`
Expected: `s1-contracts`. If not, create it per the overview worktree workflow (`git worktree add ../bitopia-s1 -b s1-contracts`) and `cd` into it.

- [ ] **Step 2: Install dependencies from the repo root**

Run: `npm install`
Expected: workspace install completes (installs `contracts` deps: `@nomicfoundation/hardhat-toolbox-viem`, `@openzeppelin/contracts`, `hardhat`).

- [ ] **Step 3: Confirm the S0 stubs compile before touching anything**

Run: `npm run build -w contracts`
Expected: "Compiled N Solidity files successfully" (the S0 stub `BTPA.sol` + `BitopiaCore.sol`).

- [ ] **Step 4: Confirm OpenZeppelin v5 is the installed major (it changed `Ownable` constructor + `ERC20Burnable` path)**

Run: `npm ls @openzeppelin/contracts -w contracts`
Expected: a `5.x` version. This plan's imports assume OZ v5 (`Ownable(initialOwner)` constructor; `token/ERC20/extensions/ERC20Burnable.sol`).

---

### Task 1: MockUSDC — 6-decimal ERC20 with a public mint faucet

**Files:**
- Create: `contracts/contracts/MockUSDC.sol`
- Create: `contracts/test/MockUSDC.ts`

- [ ] **Step 1: Write the failing test `contracts/test/MockUSDC.ts`**

```ts
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits } from "viem";

describe("MockUSDC", () => {
  async function deploy() {
    const [deployer, alice] = await hre.viem.getWalletClients();
    const usdc = await hre.viem.deployContract("MockUSDC");
    return { usdc, deployer, alice };
  }

  it("has name, symbol, and 6 decimals", async () => {
    const { usdc } = await deploy();
    expect(await usdc.read.name()).to.equal("Mock USDC");
    expect(await usdc.read.symbol()).to.equal("USDC");
    expect(await usdc.read.decimals()).to.equal(6);
  });

  it("lets anyone mint to any address (faucet)", async () => {
    const { usdc, alice } = await deploy();
    const amount = parseUnits("100", 6); // 100 USDC
    await usdc.write.mint([alice.account.address, amount]);
    const bal = await usdc.read.balanceOf([alice.account.address]);
    expect(bal).to.equal(amount);
  });

  it("a non-deployer can also mint (open faucet)", async () => {
    const { usdc, alice } = await deploy();
    const amount = parseUnits("50", 6);
    const usdcAsAlice = await hre.viem.getContractAt(
      "MockUSDC",
      usdc.address,
      { client: { wallet: alice } }
    );
    await usdcAsAlice.write.mint([alice.account.address, amount]);
    expect(await usdc.read.balanceOf([alice.account.address])).to.equal(amount);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (contract artifact does not exist yet)

Run: `npm test -w contracts`
Expected: FAIL — "Artifact for contract \"MockUSDC\" not found" (or a compile error because the source file is missing).

- [ ] **Step 3: Implement `contracts/contracts/MockUSDC.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only USDC stand-in. 6 decimals, open mint faucet.
/// Real Sepolia USDC may not be pullable by Blink, so we ship our own.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    /// @dev USDC uses 6 decimals.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet — anyone can mint demo USDC to any address.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w contracts`
Expected: PASS — the 3 MockUSDC tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/MockUSDC.sol contracts/test/MockUSDC.ts
git commit -m "feat(contracts): MockUSDC 6-decimal ERC20 with open faucet"
```

---

### Task 2: BTPA — 18-decimal ERC20Burnable with a single minter (BitopiaCore)

The frozen `IBTPA` interface (overview) requires `mint(address,uint256)` gated to the minter, plus `burn`/`burnFrom` from `ERC20Burnable`. The owner sets the minter exactly once after deploy (so `BitopiaCore` — whose address is only known after its own deploy — can be wired in).

**Files:**
- Replace: `contracts/contracts/BTPA.sol` (S0 stub → full implementation)
- Create: `contracts/test/BTPA.ts`

- [ ] **Step 1: Write the failing test `contracts/test/BTPA.ts`**

```ts
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits } from "viem";

describe("BTPA", () => {
  async function deploy() {
    const [owner, minter, alice, bob] = await hre.viem.getWalletClients();
    // owner is the deployer/initialOwner
    const btpa = await hre.viem.deployContract("BTPA", [owner.account.address]);
    return { btpa, owner, minter, alice, bob };
  }

  it("has name BTPA-ish metadata and 18 decimals", async () => {
    const { btpa } = await deploy();
    expect(await btpa.read.name()).to.equal("Bitopia Token");
    expect(await btpa.read.symbol()).to.equal("BTPA");
    expect(await btpa.read.decimals()).to.equal(18);
  });

  it("owner can set the minter exactly once", async () => {
    const { btpa, minter } = await deploy();
    await btpa.write.setMinter([minter.account.address]);
    expect(getAddress(await btpa.read.minter())).to.equal(
      getAddress(minter.account.address)
    );
  });

  it("reverts if setMinter is called twice", async () => {
    const { btpa, minter, alice } = await deploy();
    await btpa.write.setMinter([minter.account.address]);
    await expect(
      btpa.write.setMinter([alice.account.address])
    ).to.be.rejectedWith("minter already set");
  });

  it("reverts if a non-owner sets the minter", async () => {
    const { btpa, minter, alice } = await deploy();
    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await expect(
      btpaAsAlice.write.setMinter([minter.account.address])
    ).to.be.rejected; // OwnableUnauthorizedAccount
  });

  it("only the minter can mint", async () => {
    const { btpa, minter, alice } = await deploy();
    await btpa.write.setMinter([minter.account.address]);

    const btpaAsMinter = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: minter },
    });
    const amount = parseUnits("7", 18);
    await btpaAsMinter.write.mint([alice.account.address, amount]);
    expect(await btpa.read.balanceOf([alice.account.address])).to.equal(amount);
  });

  it("reverts when a non-minter tries to mint", async () => {
    const { btpa, minter, alice } = await deploy();
    await btpa.write.setMinter([minter.account.address]);

    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await expect(
      btpaAsAlice.write.mint([alice.account.address, parseUnits("1", 18)])
    ).to.be.rejectedWith("not minter");
  });

  it("holders can burn their own tokens (ERC20Burnable)", async () => {
    const { btpa, minter, alice } = await deploy();
    await btpa.write.setMinter([minter.account.address]);
    const btpaAsMinter = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: minter },
    });
    await btpaAsMinter.write.mint([alice.account.address, parseUnits("3", 18)]);

    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await btpaAsAlice.write.burn([parseUnits("1", 18)]);
    expect(await btpa.read.balanceOf([alice.account.address])).to.equal(
      parseUnits("2", 18)
    );
    expect(await btpa.read.totalSupply()).to.equal(parseUnits("2", 18));
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (S0 stub `BTPA` has no constructor arg, no `setMinter`, no `minter`, no gated `mint`)

Run: `npm test -w contracts`
Expected: FAIL — compile/ABI errors (`setMinter` / `minter` / `mint` not found, or constructor arity mismatch).

- [ ] **Step 3: Replace `contracts/contracts/BTPA.sol` with the full implementation**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Bitopia game token. 18 decimals. Mintable only by BitopiaCore.
contract BTPA is ERC20, ERC20Burnable, Ownable {
    /// @notice The only address allowed to mint (set once to BitopiaCore).
    address public minter;

    constructor(address initialOwner)
        ERC20("Bitopia Token", "BTPA")
        Ownable(initialOwner)
    {}

    /// @notice Wire BitopiaCore as the minter. One-time, owner-only.
    function setMinter(address minter_) external onlyOwner {
        require(minter == address(0), "minter already set");
        minter = minter_;
    }

    /// @notice Mint BTPA. Restricted to the minter (BitopiaCore).
    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w contracts`
Expected: PASS — all BTPA tests pass (MockUSDC tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/BTPA.sol contracts/test/BTPA.ts
git commit -m "feat(contracts): BTPA ERC20Burnable with one-time minter gate"
```

---

### Task 3: BitopiaCore — convert (USDC → BTPA)

`BitopiaCore` constructor takes `(usdc, btpa)`. `convert(usdcAmount)` pulls USDC (6dp) into the contract (treasury) via `transferFrom`, mints BTPA to `msg.sender` normalizing 6→18 decimals (`usdcAmount * 1e12`), and emits `Converted(user, usdcIn, btpaOut)`. Must match the frozen `IBitopiaCore`. Build it incrementally: convert first (this task), createAgent next (Task 4).

**Files:**
- Replace: `contracts/contracts/BitopiaCore.sol` (S0 stub → full implementation)
- Create: `contracts/test/BitopiaCore.convert.ts`

- [ ] **Step 1: Write the failing test `contracts/test/BitopiaCore.convert.ts`**

```ts
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits } from "viem";

describe("BitopiaCore.convert", () => {
  async function deploy() {
    const [owner, alice] = await hre.viem.getWalletClients();
    const usdc = await hre.viem.deployContract("MockUSDC");
    const btpa = await hre.viem.deployContract("BTPA", [owner.account.address]);
    const core = await hre.viem.deployContract("BitopiaCore", [
      usdc.address,
      btpa.address,
    ]);
    // Wire BitopiaCore as the BTPA minter.
    await btpa.write.setMinter([core.address]);
    return { usdc, btpa, core, owner, alice };
  }

  it("exposes the immutable token addresses", async () => {
    const { usdc, btpa, core } = await deploy();
    expect(getAddress(await core.read.usdc())).to.equal(getAddress(usdc.address));
    expect(getAddress(await core.read.btpa())).to.equal(getAddress(btpa.address));
  });

  it("pulls USDC and mints BTPA 1:1 normalized 6->18 decimals", async () => {
    const { usdc, btpa, core, alice } = await deploy();

    const usdcIn = parseUnits("10", 6); // 10 USDC (6dp)
    const expectedBtpa = parseUnits("10", 18); // 10 BTPA (18dp)

    // Give Alice USDC and approve the core.
    await usdc.write.mint([alice.account.address, usdcIn]);
    const usdcAsAlice = await hre.viem.getContractAt("MockUSDC", usdc.address, {
      client: { wallet: alice },
    });
    await usdcAsAlice.write.approve([core.address, usdcIn]);

    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await coreAsAlice.write.convert([usdcIn]);

    // Alice spent USDC; core (treasury) holds it.
    expect(await usdc.read.balanceOf([alice.account.address])).to.equal(0n);
    expect(await usdc.read.balanceOf([core.address])).to.equal(usdcIn);

    // Alice received BTPA at the normalized rate.
    expect(await btpa.read.balanceOf([alice.account.address])).to.equal(
      expectedBtpa
    );
    expect(await btpa.read.totalSupply()).to.equal(expectedBtpa);
  });

  it("emits Converted with user, usdcIn, btpaOut", async () => {
    const { usdc, core, alice } = await deploy();
    const usdcIn = parseUnits("3", 6);
    const expectedBtpa = parseUnits("3", 18);

    await usdc.write.mint([alice.account.address, usdcIn]);
    const usdcAsAlice = await hre.viem.getContractAt("MockUSDC", usdc.address, {
      client: { wallet: alice },
    });
    await usdcAsAlice.write.approve([core.address, usdcIn]);
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });

    const hash = await coreAsAlice.write.convert([usdcIn]);
    const publicClient = await hre.viem.getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash });

    const events = await core.getEvents.Converted();
    expect(events).to.have.length(1);
    expect(getAddress(events[0].args.user!)).to.equal(
      getAddress(alice.account.address)
    );
    expect(events[0].args.usdcIn).to.equal(usdcIn);
    expect(events[0].args.btpaOut).to.equal(expectedBtpa);
  });

  it("reverts when the user has not approved USDC", async () => {
    const { usdc, core, alice } = await deploy();
    const usdcIn = parseUnits("5", 6);
    await usdc.write.mint([alice.account.address, usdcIn]);
    // No approve.
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await expect(coreAsAlice.write.convert([usdcIn])).to.be.rejected;
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (S0 stub `BitopiaCore` has no constructor, no `usdc`/`btpa`, no `convert`)

Run: `npm test -w contracts`
Expected: FAIL — compile/ABI errors (`convert` / `usdc` / `btpa` not found, constructor arity mismatch).

- [ ] **Step 3: Replace `contracts/contracts/BitopiaCore.sol` with the convert implementation**

(Note: this file is replaced again in Task 4 to add `createAgent`. Write the full file now with convert only; Task 4 re-writes it complete.)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IBTPAMintBurn {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
}

/// @notice Convert + agent-creation logic for Bitopia.
contract BitopiaCore {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IBTPAMintBurn public immutable btpa;

    /// @dev USDC has 6 decimals, BTPA has 18 -> scale by 1e12.
    uint256 public constant DECIMALS_SCALE = 1e12;

    uint256 public constant CREATE_FEE = 5e18;
    uint256 public constant AGENT_SEED = 5e18;

    event Converted(address indexed user, uint256 usdcIn, uint256 btpaOut);
    event AgentFunded(address indexed owner, address indexed agentWallet, uint256 seed);

    constructor(address usdc_, address btpa_) {
        usdc = IERC20(usdc_);
        btpa = IBTPAMintBurn(btpa_);
    }

    /// @notice Pull `usdcAmount` USDC (6dp) from caller into treasury,
    ///         mint BTPA 1:1 (normalized to 18dp) to the caller.
    function convert(uint256 usdcAmount) external {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        uint256 btpaOut = usdcAmount * DECIMALS_SCALE;
        btpa.mint(msg.sender, btpaOut);
        emit Converted(msg.sender, usdcAmount, btpaOut);
    }
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w contracts`
Expected: PASS — all convert tests pass (MockUSDC + BTPA tests still pass).

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/BitopiaCore.sol contracts/test/BitopiaCore.convert.ts
git commit -m "feat(contracts): BitopiaCore.convert pulls USDC + mints BTPA 1:1"
```

---

### Task 4: BitopiaCore — createAgent (burn fee + seed agent wallet)

`createAgent(agentWallet)` pulls `CREATE_FEE + AGENT_SEED` (10e18) BTPA from `msg.sender` into the contract, burns `CREATE_FEE` (5e18), transfers `AGENT_SEED` (5e18) to `agentWallet`, and emits `AgentFunded(owner, agentWallet, seed)`. Reverts on zero address and on missing approval. BTPA is `ERC20Burnable`, so the contract pulls the full 10 BTPA to itself, then `burn`s 5 and `transfer`s 5 — clean and only one approval needed from the user.

**Files:**
- Replace: `contracts/contracts/BitopiaCore.sol` (add `createAgent`)
- Create: `contracts/test/BitopiaCore.createAgent.ts`

- [ ] **Step 1: Write the failing test `contracts/test/BitopiaCore.createAgent.ts`**

```ts
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits, zeroAddress } from "viem";

describe("BitopiaCore.createAgent", () => {
  async function deploy() {
    const [owner, alice, agentWallet] = await hre.viem.getWalletClients();
    const usdc = await hre.viem.deployContract("MockUSDC");
    const btpa = await hre.viem.deployContract("BTPA", [owner.account.address]);
    const core = await hre.viem.deployContract("BitopiaCore", [
      usdc.address,
      btpa.address,
    ]);
    await btpa.write.setMinter([core.address]);
    return { usdc, btpa, core, owner, alice, agentWallet };
  }

  // Give `alice` BTPA via the convert path so balances are realistic.
  async function fundAliceBtpa(ctx: any, btpaAmount: bigint) {
    const { usdc, core, alice } = ctx;
    const usdcIn = btpaAmount / 10n ** 12n; // inverse of the 1e12 scale
    await usdc.write.mint([alice.account.address, usdcIn]);
    const usdcAsAlice = await hre.viem.getContractAt("MockUSDC", usdc.address, {
      client: { wallet: alice },
    });
    await usdcAsAlice.write.approve([core.address, usdcIn]);
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await coreAsAlice.write.convert([usdcIn]);
  }

  it("constants are 5e18 each", async () => {
    const { core } = await deploy();
    expect(await core.read.CREATE_FEE()).to.equal(parseUnits("5", 18));
    expect(await core.read.AGENT_SEED()).to.equal(parseUnits("5", 18));
  });

  it("burns CREATE_FEE, seeds agentWallet, drops total supply by the fee", async () => {
    const ctx = await deploy();
    const { btpa, core, alice, agentWallet } = ctx;

    await fundAliceBtpa(ctx, parseUnits("10", 18)); // Alice now has 10 BTPA
    expect(await btpa.read.totalSupply()).to.equal(parseUnits("10", 18));

    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await btpaAsAlice.write.approve([core.address, parseUnits("10", 18)]);

    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await coreAsAlice.write.createAgent([agentWallet.account.address]);

    // Alice spent all 10 BTPA.
    expect(await btpa.read.balanceOf([alice.account.address])).to.equal(0n);
    // Agent wallet got the 5 BTPA seed.
    expect(await btpa.read.balanceOf([agentWallet.account.address])).to.equal(
      parseUnits("5", 18)
    );
    // Core retains nothing (pulled 10, burned 5, sent 5).
    expect(await btpa.read.balanceOf([core.address])).to.equal(0n);
    // Total supply dropped by the burned fee: 10 -> 5.
    expect(await btpa.read.totalSupply()).to.equal(parseUnits("5", 18));
  });

  it("emits AgentFunded(owner, agentWallet, seed)", async () => {
    const ctx = await deploy();
    const { btpa, core, alice, agentWallet } = ctx;
    await fundAliceBtpa(ctx, parseUnits("10", 18));

    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await btpaAsAlice.write.approve([core.address, parseUnits("10", 18)]);
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });

    const hash = await coreAsAlice.write.createAgent([agentWallet.account.address]);
    const publicClient = await hre.viem.getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash });

    const events = await core.getEvents.AgentFunded();
    expect(events).to.have.length(1);
    expect(getAddress(events[0].args.owner!)).to.equal(
      getAddress(alice.account.address)
    );
    expect(getAddress(events[0].args.agentWallet!)).to.equal(
      getAddress(agentWallet.account.address)
    );
    expect(events[0].args.seed).to.equal(parseUnits("5", 18));
  });

  it("reverts on the zero agent address", async () => {
    const ctx = await deploy();
    const { btpa, core, alice } = ctx;
    await fundAliceBtpa(ctx, parseUnits("10", 18));
    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await btpaAsAlice.write.approve([core.address, parseUnits("10", 18)]);
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await expect(
      coreAsAlice.write.createAgent([zeroAddress])
    ).to.be.rejectedWith("zero agent");
  });

  it("reverts when BTPA is not approved", async () => {
    const ctx = await deploy();
    const { core, alice, agentWallet } = ctx;
    await fundAliceBtpa(ctx, parseUnits("10", 18));
    // No BTPA approve.
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await expect(
      coreAsAlice.write.createAgent([agentWallet.account.address])
    ).to.be.rejected;
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (`createAgent` not yet defined on `BitopiaCore`)

Run: `npm test -w contracts`
Expected: FAIL — ABI error: `createAgent` not found.

- [ ] **Step 3: Replace `contracts/contracts/BitopiaCore.sol` with the complete implementation (convert + createAgent)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IBTPAMintBurn {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
}

/// @notice Convert + agent-creation logic for Bitopia.
contract BitopiaCore {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable btpa;

    /// @dev USDC has 6 decimals, BTPA has 18 -> scale by 1e12.
    uint256 public constant DECIMALS_SCALE = 1e12;

    uint256 public constant CREATE_FEE = 5e18;
    uint256 public constant AGENT_SEED = 5e18;

    event Converted(address indexed user, uint256 usdcIn, uint256 btpaOut);
    event AgentFunded(address indexed owner, address indexed agentWallet, uint256 seed);

    constructor(address usdc_, address btpa_) {
        usdc = IERC20(usdc_);
        btpa = btpa_;
    }

    /// @notice Pull `usdcAmount` USDC (6dp) from caller into treasury,
    ///         mint BTPA 1:1 (normalized to 18dp) to the caller.
    function convert(uint256 usdcAmount) external {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        uint256 btpaOut = usdcAmount * DECIMALS_SCALE;
        IBTPAMintBurn(btpa).mint(msg.sender, btpaOut);
        emit Converted(msg.sender, usdcAmount, btpaOut);
    }

    /// @notice Pull CREATE_FEE+AGENT_SEED BTPA from caller, burn the fee,
    ///         seed the agent wallet with AGENT_SEED.
    function createAgent(address agentWallet) external {
        require(agentWallet != address(0), "zero agent");
        uint256 total = CREATE_FEE + AGENT_SEED;
        // Pull the full amount into this contract first.
        IERC20(btpa).safeTransferFrom(msg.sender, address(this), total);
        // Burn the creation fee (BTPA is ERC20Burnable; burns this contract's balance).
        IBTPAMintBurn(btpa).burn(CREATE_FEE);
        // Seed the agent wallet.
        IERC20(btpa).safeTransfer(agentWallet, AGENT_SEED);
        emit AgentFunded(msg.sender, agentWallet, AGENT_SEED);
    }
}
```

- [ ] **Step 4: Run it; expect PASS**

Run: `npm test -w contracts`
Expected: PASS — all createAgent tests pass, and the convert tests (Task 3) still pass (convert is unchanged behaviorally; the only refactor is `btpa` is now stored as `address` and cast at call sites).

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/BitopiaCore.sol contracts/test/BitopiaCore.createAgent.ts
git commit -m "feat(contracts): BitopiaCore.createAgent burns fee + seeds agent wallet"
```

---

### Task 5: Access-control cross-check (only BitopiaCore can mint BTPA)

A dedicated test that proves the wiring: after `setMinter(core)`, BTPA mint by anyone other than the core reverts, and the full convert path mints correctly through the core. This guards the most security-sensitive seam.

**Files:**
- Create: `contracts/test/AccessControl.ts`

- [ ] **Step 1: Write the failing test `contracts/test/AccessControl.ts`**

```ts
import { expect } from "chai";
import hre from "hardhat";
import { parseUnits } from "viem";

describe("BTPA mint access control via BitopiaCore", () => {
  async function deploy() {
    const [owner, alice] = await hre.viem.getWalletClients();
    const usdc = await hre.viem.deployContract("MockUSDC");
    const btpa = await hre.viem.deployContract("BTPA", [owner.account.address]);
    const core = await hre.viem.deployContract("BitopiaCore", [
      usdc.address,
      btpa.address,
    ]);
    await btpa.write.setMinter([core.address]);
    return { usdc, btpa, core, owner, alice };
  }

  it("the owner cannot mint BTPA directly (only the core can)", async () => {
    const { btpa, owner } = await deploy();
    // owner is the deployer/initialOwner but NOT the minter.
    await expect(
      btpa.write.mint([owner.account.address, parseUnits("1", 18)])
    ).to.be.rejectedWith("not minter");
  });

  it("an arbitrary account cannot mint BTPA", async () => {
    const { btpa, alice } = await deploy();
    const btpaAsAlice = await hre.viem.getContractAt("BTPA", btpa.address, {
      client: { wallet: alice },
    });
    await expect(
      btpaAsAlice.write.mint([alice.account.address, parseUnits("1", 18)])
    ).to.be.rejectedWith("not minter");
  });

  it("minting only happens through BitopiaCore.convert", async () => {
    const { usdc, btpa, core, alice } = await deploy();
    const usdcIn = parseUnits("2", 6);
    await usdc.write.mint([alice.account.address, usdcIn]);
    const usdcAsAlice = await hre.viem.getContractAt("MockUSDC", usdc.address, {
      client: { wallet: alice },
    });
    await usdcAsAlice.write.approve([core.address, usdcIn]);
    const coreAsAlice = await hre.viem.getContractAt("BitopiaCore", core.address, {
      client: { wallet: alice },
    });
    await coreAsAlice.write.convert([usdcIn]);
    expect(await btpa.read.balanceOf([alice.account.address])).to.equal(
      parseUnits("2", 18)
    );
  });
});
```

- [ ] **Step 2: Run it; expect PASS** (the contracts already enforce this — this test documents and locks the behavior)

Run: `npm test -w contracts`
Expected: PASS — all access-control tests pass alongside everything else.

> If any of these fail, STOP and use superpowers:systematic-debugging — a failure here means the minter gate is wrong, which is a security defect, not a test issue.

- [ ] **Step 3: Run the full suite once for a clean baseline**

Run: `npm test -w contracts`
Expected: PASS — MockUSDC + BTPA + convert + createAgent + access-control suites all green.

- [ ] **Step 4: Commit**

```bash
git add contracts/test/AccessControl.ts
git commit -m "test(contracts): lock BTPA mint to BitopiaCore only"
```

---

### Task 6: Deploy script + artifacts (deployments/sepolia.json + ABI export)

`scripts/deploy.ts` deploys `MockUSDC`, `BTPA`, `BitopiaCore`; wires `BitopiaCore` as the BTPA minter; writes `contracts/deployments/sepolia.json` (`{chainId, BTPA, BitopiaCore, USDC}`); and exports ABIs to `shared/abi/{BTPA,BitopiaCore,MockUSDC}.json` for S2/S3/S4. It must be runnable against a local Hardhat node first (cheap verification), then against Sepolia.

**Files:**
- Create: `contracts/scripts/deploy.ts`
- (Generated at runtime: `contracts/deployments/sepolia.json`, `shared/abi/BTPA.json`, `shared/abi/BitopiaCore.json`, `shared/abi/MockUSDC.json`)

- [ ] **Step 1: Create `contracts/scripts/deploy.ts`**

```ts
import hre from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(here, "..");
const repoRoot = join(contractsRoot, "..");

function exportAbi(name: string) {
  // Hardhat artifact lives at artifacts/contracts/<name>.sol/<name>.json
  const artifact = hre.artifacts.readArtifactSync(name);
  const abiDir = join(repoRoot, "shared", "abi");
  mkdirSync(abiDir, { recursive: true });
  writeFileSync(
    join(abiDir, `${name}.json`),
    JSON.stringify(artifact.abi, null, 2) + "\n"
  );
  console.log(`exported ABI -> shared/abi/${name}.json`);
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  console.log(`deployer: ${deployer.account.address}`);
  console.log(`chainId:  ${chainId}`);

  // 1. MockUSDC (6-decimal demo USDC with an open faucet).
  const usdc = await hre.viem.deployContract("MockUSDC");
  console.log(`MockUSDC:    ${usdc.address}`);

  // 2. BTPA (owner = deployer so we can set the minter next).
  const btpa = await hre.viem.deployContract("BTPA", [deployer.account.address]);
  console.log(`BTPA:        ${btpa.address}`);

  // 3. BitopiaCore wired to both tokens.
  const core = await hre.viem.deployContract("BitopiaCore", [
    usdc.address,
    btpa.address,
  ]);
  console.log(`BitopiaCore: ${core.address}`);

  // 4. Wire BitopiaCore as the one-time BTPA minter.
  const setMinterHash = await btpa.write.setMinter([core.address]);
  await publicClient.waitForTransactionReceipt({ hash: setMinterHash });
  console.log(`setMinter -> BitopiaCore (tx ${setMinterHash})`);

  // 5. Write deployments/sepolia.json (shape from the overview).
  const deployments = {
    chainId,
    BTPA: btpa.address,
    BitopiaCore: core.address,
    USDC: usdc.address,
  };
  const deployDir = join(contractsRoot, "deployments");
  mkdirSync(deployDir, { recursive: true });
  writeFileSync(
    join(deployDir, "sepolia.json"),
    JSON.stringify(deployments, null, 2) + "\n"
  );
  console.log("wrote contracts/deployments/sepolia.json");

  // 6. Export ABIs for the rest of the build (S2/S3/S4).
  exportAbi("BTPA");
  exportAbi("BitopiaCore");
  exportAbi("MockUSDC");

  console.log("deploy complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Compile so artifacts exist for the ABI export**

Run: `npm run build -w contracts`
Expected: "Compiled N Solidity files successfully" (MockUSDC, BTPA, BitopiaCore).

- [ ] **Step 3: Dry-run the deploy against an ephemeral local Hardhat network**

Run: `cd contracts && npx hardhat run scripts/deploy.ts`
Expected output includes: deployer address, `chainId: 31337` (the in-process Hardhat network), the three contract addresses, `setMinter -> BitopiaCore`, `wrote contracts/deployments/sepolia.json`, and three `exported ABI -> shared/abi/<name>.json` lines, then `deploy complete.`

> The default in-process network reports chainId 31337; the file is still named `sepolia.json` (it is the deployment-artifact filename, not chain-gated). The real values land when run with `--network sepolia` in Step 5.

- [ ] **Step 4: Verify the generated artifacts exist and have the right shape**

Run: `cat contracts/deployments/sepolia.json && ls shared/abi`
Expected: `sepolia.json` contains keys `chainId`, `BTPA`, `BitopiaCore`, `USDC` with `0x…` addresses; `shared/abi/` lists `BTPA.json`, `BitopiaCore.json`, `MockUSDC.json`.

- [ ] **Step 5: (Real network — requires funded `DEPLOYER_PRIVATE_KEY` + `SEPOLIA_RPC_URL` in `.env`) Deploy to Sepolia**

Run: `npm run deploy:sepolia -w contracts`
Expected: same console flow but `chainId: 11155111` and real Sepolia addresses; `sepolia.json` now holds the live addresses and ABIs reflect the deployed contracts.

> This step needs Sepolia ETH in the deployer wallet. If keys/RPC are not yet provisioned, skip the broadcast and rerun Step 3 locally — the script is identical, only the network differs. Do not block the stream on real-network funds.

- [ ] **Step 6: Commit script + artifacts**

```bash
git add contracts/scripts/deploy.ts contracts/deployments/sepolia.json shared/abi/BTPA.json shared/abi/BitopiaCore.json shared/abi/MockUSDC.json
git commit -m "feat(contracts): deploy script writes sepolia.json + exports ABIs"
```

> NOTE: `.gitignore` (from S0) ignores `contracts/artifacts` and `contracts/cache` but NOT `contracts/deployments` or `shared/abi` — those are intentionally committed artifacts consumed by other streams. If `git add` of `sepolia.json` is silently ignored, check `.gitignore` and `git add -f` only these two paths (do not commit `artifacts/`).

---

### Task 7: Final verification

- [ ] **Step 1: Clean full run**

Run: `npm test -w contracts`
Expected: PASS — every suite green (MockUSDC, BTPA, BitopiaCore.convert, BitopiaCore.createAgent, AccessControl).

- [ ] **Step 2: Confirm seam compliance against the overview**

Manually verify the deployed surface matches `IBTPA` / `IBitopiaCore` exactly:
- `BTPA.mint(address,uint256)`, `burn(uint256)`, `burnFrom(address,uint256)` (last two via `ERC20Burnable`).
- `BitopiaCore.convert(uint256)`, `createAgent(address)`, `CREATE_FEE() returns (uint256)`, `AGENT_SEED() returns (uint256)`.
- Events: `Converted(address indexed user, uint256 usdcIn, uint256 btpaOut)`, `AgentFunded(address indexed owner, address indexed agentWallet, uint256 seed)`.
- `deployments/sepolia.json` keys: `chainId`, `BTPA`, `BitopiaCore`, `USDC`.

If any signature differs from the overview, STOP — do not "fix" the seam; flag the human (per the cross-stream convention).

- [ ] **Step 3: Use superpowers:verification-before-completion** before claiming done — paste the actual test output and the `cat sepolia.json` / `ls shared/abi` output as evidence.

- [ ] **Step 4: Stream complete** — `s1-contracts` is ready to merge (merge order S1→S2→S3 per the overview). No source files outside `/contracts` and `shared/abi/` were touched.

---

## Self-review notes

- **Seam compliance:** `mint/burn/burnFrom` on BTPA, `convert/createAgent/CREATE_FEE/AGENT_SEED` + `Converted/AgentFunded` events on BitopiaCore, and the `{chainId,BTPA,BitopiaCore,USDC}` deployment shape all match the frozen overview interfaces verbatim. No seam was added or changed.
- **Scope discipline:** only `/contracts/**` and `shared/abi/*.json` are written. No server/client files touched. No dependency on other streams.
- **Decimals:** MockUSDC = 6dp, BTPA = 18dp, `convert` scales by `1e12`. createAgent uses whole 18dp constants (5e18).
- **createAgent burn mechanic:** the contract pulls the full 10 BTPA to itself, then `burn(5e18)` on its own balance and `transfer(5e18)` to the agent — one user approval, total supply provably drops by the burned fee (asserted in the test).
- **Minter gate:** `setMinter` is one-time + owner-only; `mint` is minter-only. A dedicated AccessControl suite proves no one but BitopiaCore can mint.
- **Assumptions / risks:**
  - **OpenZeppelin v5** assumed (`Ownable(initialOwner)` constructor, `extensions/ERC20Burnable.sol`). Task 0 Step 4 checks this; if v4 is installed, adjust the `Ownable` constructor (no arg) and remove `initialOwner`.
  - **Blink / USDC:** per the spec risk register, real Sepolia USDC may not be pullable by Blink. We ship `MockUSDC` with an open faucet to de-risk the demo on-ramp; if Blink mandates a specific token on day one, swap the `USDC` address in the deploy + faucet flow (no BitopiaCore change needed — it takes the USDC address by constructor).
  - **Real Sepolia deploy** needs a funded deployer wallet + RPC; the script is validated locally first so the stream never blocks on testnet funds.
  - The deploy artifact is named `sepolia.json` even when dry-run locally; only the `--network sepolia` run yields the production addresses.
