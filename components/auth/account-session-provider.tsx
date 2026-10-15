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

// Safe default for a consumer rendered outside the provider (for example Next's built-in 404 page
// during static generation): behave as "session still loading" instead of crashing the render.
const fallbackSession: AccountSessionContextValue = {
  session: null,
  isSessionPending: true,
  isAccountServiceUnavailable: false,
  signOut: async () => undefined,
};

const AccountSessionContext = createContext<AccountSessionContextValue>(fallbackSession);

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
  return useContext(AccountSessionContext);
}
