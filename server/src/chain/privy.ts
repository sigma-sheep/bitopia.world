import { PrivyClient } from "@privy-io/server-auth";
import { config } from "../config";

// One shared Privy client. Reads PRIVY_APP_ID / PRIVY_APP_SECRET from config.
export const privy = new PrivyClient(config.privyAppId, config.privyAppSecret);

// Verify a handshake/access token from the client; returns the Privy user id (DID).
export async function verifyPrivyToken(token: string): Promise<{ userId: string }> {
  const claims = await privy.verifyAuthToken(token);
  return { userId: claims.userId };
}

// Resolve the user's embedded wallet address from their linked accounts.
export async function getUserAddress(privyUserId: string): Promise<`0x${string}`> {
  const user = await privy.getUser(privyUserId);
  const wallet = (user.linkedAccounts ?? []).find(
    (a: any) => a.type === "wallet" && a.chainType === "ethereum"
  ) as { address?: string } | undefined;
  const addr = wallet?.address ?? (user.wallet as { address?: string } | undefined)?.address;
  if (!addr) throw new Error("no embedded wallet on privy user");
  return addr as `0x${string}`;
}
