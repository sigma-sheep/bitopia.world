import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const appId =
  (import.meta.env as Record<string, string>).VITE_PRIVY_APP_ID ?? "";
console.log("appId", appId);
// Wraps the app in Privy. Email/wallet login plus guest accounts, and every user
// without a wallet gets an embedded one created on login (that's the address an
// ENS subname will point at).
export function AppPrivyProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        appearance: { theme: "dark" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
