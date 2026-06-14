import { erc20Abi, formatEther, formatUnits, type Address } from "viem";

// Mainnet USDC (6 decimals). The player's "money" lives here.
const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const DASH = "—";

export interface Balances {
  usdc: string;
  eth: string;
}

// Just the two reads we need from viem's PublicClient — narrowed so the function
// is trivially testable with a stub and can't reach the network on its own.
interface BalanceClient {
  readContract(args: any): Promise<unknown>;
  getBalance(args: { address: Address }): Promise<bigint>;
}

// Read USDC + native ETH for an address and format them as human decimal strings.
// Any RPC failure degrades to dashes so the HUD shows "—" instead of crashing.
export async function readBalances(client: BalanceClient, address: Address): Promise<Balances> {
  try {
    const [usdcRaw, ethRaw] = await Promise.all([
      client.readContract({
        address: USDC_MAINNET,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
      client.getBalance({ address }),
    ]);
    return { usdc: formatUnits(usdcRaw, 6), eth: formatEther(ethRaw) };
  } catch {
    return { usdc: DASH, eth: DASH };
  }
}
