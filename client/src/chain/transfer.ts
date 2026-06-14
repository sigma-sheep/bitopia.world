import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import type { useSendTransaction } from "@privy-io/react-auth";
import { CHAIN_ID, USDC } from "./usdc";

// Privy's sendTransaction, typed off the hook so callers pass it straight in.
type SendTransaction = ReturnType<typeof useSendTransaction>["sendTransaction"];

// Send `amount` USDC (a decimal string, e.g. "1.5") from the caller's embedded
// wallet to `to`. The user confirms in a Privy modal; gas is sponsored so the
// wallet needs no ETH. Returns the tx hash. Used by both withdraw (WalletHud)
// and player-to-player transfers (PlayerMenu) so the send path stays in one place.
export async function transferUsdc(
  sendTransaction: SendTransaction,
  to: `0x${string}`,
  amount: string,
): Promise<string> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, parseUnits(amount, 6)], // USDC has 6 decimals
  });
  const { hash } = await sendTransaction(
    { to: USDC, data, chainId: CHAIN_ID },
    { sponsor: true },
  );
  return hash;
}
