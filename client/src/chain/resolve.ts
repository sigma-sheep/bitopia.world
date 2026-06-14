import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const env = import.meta.env as Record<string, string>;

// Read-only mainnet client used only to resolve ENS names → addresses. Uses a
// configured RPC when provided, otherwise viem's default public mainnet endpoint.
// ENS (incl. our *.bitopiaworld.eth subnames) always lives on mainnet, regardless
// of where funds move.
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(env.VITE_MAINNET_RPC_URL || undefined),
});

// Resolve a withdrawal destination to a 0x address. A hex address passes through
// unchanged; an ENS name is resolved on-chain. Returns null when the name doesn't
// resolve (no addr record / bad name) so the caller can show a clear message.
export async function resolveDestination(
  dest: string,
): Promise<`0x${string}` | null> {
  const trimmed = dest.trim();
  if (isAddress(trimmed)) return trimmed;
  try {
    return await publicClient.getEnsAddress({ name: normalize(trimmed) });
  } catch {
    return null;
  }
}
