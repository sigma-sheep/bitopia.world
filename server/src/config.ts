import dotenv from "dotenv";
import { resolve } from "node:path";

// Env lives in a single .env at the repo root. The server process runs from
// server/, where bare `dotenv/config` would look for server/.env and miss it.
// Load explicitly, tolerating launch from either the repo root or server/.
dotenv.config({ path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")] });

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? "bitopia.sqlite",
  mainnetRpcUrl: process.env.MAINNET_RPC_URL ?? process.env.RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "",
  deployerKey: process.env.DEPLOYER_PRIVATE_KEY ?? "",
  privyAppId: process.env.PRIVY_APP_ID ?? "",
  privyAppSecret: process.env.PRIVY_APP_SECRET ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  ensParentName: process.env.ENS_PARENT_NAME ?? "bitopiaworld.eth",
  ensParentOwnerKey: process.env.ENS_PARENT_OWNER_KEY ?? "",
};
