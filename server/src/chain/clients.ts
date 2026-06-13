import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { config } from "../config";

function normKey(k: string): Hex {
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

// Read-only client for namehash lookups / receipts. Falls back to a public RPC if
// none is configured so reads still work in dev.
export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(config.mainnetRpcUrl || undefined),
});

// Wallet that owns the parent ENS name (bitopiaworld.eth) and pays to mint
// subnames. Undefined when no key is configured — ENS issuance is then disabled
// and the app degrades to storing the username without an on-chain name.
const ownerKey = config.ensParentOwnerKey || config.deployerKey;

export const ensOwnerAccount = ownerKey ? privateKeyToAccount(normKey(ownerKey)) : undefined;

export const ensOwnerClient = ensOwnerAccount
  ? createWalletClient({ account: ensOwnerAccount, chain: mainnet, transport: http(config.mainnetRpcUrl || undefined) })
  : undefined;
