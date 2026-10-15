"use client";

import { createContext, useContext, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

export type AccountSession = {
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
};

type AccountSessionContextValue = {
  session: AccountSession | null;
  isSessionPending: boolean;
  isAccountServiceUnavailable: boolean;
  signOut: () => Promise<void>;
};

const AccountSessionContext = createContext<AccountSessionContextValue | null>(null);

export function AccountSessionProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error } = authClient.useSession();

  const session: AccountSession | null = data?.user
    ? {
        id: data.user.id,
        displayName: data.user.name,
        email: data.user.email,
        emailVerified: data.user.emailVerified,
      }
    : null;

  async function signOut() {
    await authClient.signOut();
  }

  return (
    <AccountSessionContext.Provider
      value={{
        session,
        isSessionPending: isPending,
        isAccountServiceUnavailable: error?.status === 503,
        signOut,
      }}
    >
      {children}
    </AccountSessionContext.Provider>
  );
}

export function useAccountSession() {
  const value = useContext(AccountSessionContext);
  if (!value) {
    throw new Error("useAccountSession must be used inside AccountSessionProvider.");
  }
  return value;
}
