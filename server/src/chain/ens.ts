import type { Hex } from "viem";
import { config } from "../config";
import { namehash, fullName } from "./ensName";
import { ensOwnerClient, publicClient } from "./clients";

// Mainnet ENS deployments (verified on-chain). VERIFY on a block explorer before
// relying on them — if they ever change, only these two constants move.
const MAINNET_NAME_WRAPPER = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401" as const;
const MAINNET_PUBLIC_RESOLVER = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63" as const;

const nameWrapperAbi = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "node", type: "bytes32" }],
  },
] as const;

const resolverAbi = [
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [{ name: "node", type: "bytes32" }, { name: "addr", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }, { name: "value", type: "string" }],
    outputs: [],
  },
] as const;

// True when a parent-owner wallet is configured and we can mint subnames on-chain.
export function ensConfigured(): boolean {
  return ensOwnerClient !== undefined;
}

export interface SubnameResult {
  name: string;
  node: Hex;
  txHash: string;
}

// Issues `<label>.bitopiaworld.eth` on Ethereum mainnet: mint the wrapped subname,
// point its addr record at `userAddress`, and set an avatar text record.
// Throws if ENS isn't configured or the on-chain mint reverts (e.g. name taken).
export async function ensureUserSubname(
  label: string,
  userAddress: `0x${string}`,
  avatarColor: string
): Promise<SubnameResult> {
  if (!ensOwnerClient || !ensOwnerClient.account) {
    throw new Error("ENS issuance not configured (set ENS_PARENT_OWNER_KEY or DEPLOYER_PRIVATE_KEY)");
  }
  const parent = config.ensParentName;
  const name = fullName(label, parent);
  const parentNode = namehash(parent);
  const node = namehash(name);

  // The parent-owner wallet KEEPS ownership of the subname so it stays authorised
  // to write the resolver records below. Handing ownership straight to the user
  // here (as we did before) makes the subname exist but then reverts setAddr/setText
  // with "not authorised" — only the node's current owner may set its records. The
  // user is represented by the addr record, which resolves the name to their wallet.
  const txHash = await ensOwnerClient.writeContract({
    account: ensOwnerClient.account,
    chain: ensOwnerClient.chain,
    address: MAINNET_NAME_WRAPPER,
    abi: nameWrapperAbi,
    functionName: "setSubnodeRecord",
    args: [parentNode, label.toLowerCase(), ensOwnerClient.account.address, MAINNET_PUBLIC_RESOLVER, 0n, 0, 0n],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  await ensOwnerClient.writeContract({
    account: ensOwnerClient.account,
    chain: ensOwnerClient.chain,
    address: MAINNET_PUBLIC_RESOLVER,
    abi: resolverAbi,
    functionName: "setAddr",
    args: [node, userAddress],
  });
  await ensOwnerClient.writeContract({
    account: ensOwnerClient.account,
    chain: ensOwnerClient.chain,
    address: MAINNET_PUBLIC_RESOLVER,
    abi: resolverAbi,
    functionName: "setText",
    args: [node, "avatar", avatarColor],
  });

  return { name, node, txHash };
}
