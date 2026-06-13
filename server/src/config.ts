import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? "bitopia.sqlite",
  sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? "",
  deployerKey: process.env.DEPLOYER_PRIVATE_KEY ?? "",
  privyAppId: process.env.PRIVY_APP_ID ?? "",
  privyAppSecret: process.env.PRIVY_APP_SECRET ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  ensParentName: process.env.ENS_PARENT_NAME ?? "bitopiaworld.eth",
  ensParentOwnerKey: process.env.ENS_PARENT_OWNER_KEY ?? "",
};
