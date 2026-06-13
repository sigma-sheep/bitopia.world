import { keccak256, toBytes, concat, type Hex } from "viem";

const ZERO_NODE: Hex = ("0x" + "00".repeat(32)) as Hex;

// keccak256 of a single (lowercased) label.
export function labelhash(label: string): Hex {
  return keccak256(toBytes(label.toLowerCase()));
}

// ENS namehash (EIP-137): fold labels right-to-left into the zero root.
export function namehash(name: string): Hex {
  let node = ZERO_NODE;
  const normalized = name.toLowerCase();
  if (normalized === "") return node;
  const labels = normalized.split(".");
  for (let i = labels.length - 1; i >= 0; i--) {
    node = keccak256(concat([node, labelhash(labels[i])]));
  }
  return node;
}

// "<label>.<parent>", lowercased.
export function fullName(label: string, parent: string): string {
  return `${label.toLowerCase()}.${parent.toLowerCase()}`;
}
