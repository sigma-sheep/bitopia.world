import { PrivyProvider } from "@privy-io/react-auth";
import { mainnet } from "viem/chains";
import type { ReactNode } from "react";

const appId =
  (import.meta.env as Record<string, string>).VITE_PRIVY_APP_ID ?? "";
// Wraps the app in Privy. Email/wallet login plus guest accounts, and every user
// without a wallet gets an embedded one created on login (that's the address an
// ENS subname will point at).
//
// Pin Ethereum mainnet as the supported/default chain: USDC, ENS and gas
// sponsorship all live on mainnet, and Privy throws on sendTransaction for a
// chain that isn't in supportedChains. Without this the embedded wallet has no
// mainnet config and transfers fail (e.g. "signal is aborted without reason").
export function AppPrivyProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        appearance: { theme: "dark" },
        defaultChain: mainnet,
        supportedChains: [mainnet],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
