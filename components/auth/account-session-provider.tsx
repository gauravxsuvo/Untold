"use client";

import { createContext, useContext, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { safeProfilePhotoUrl } from "@/lib/profile/photos";

export type AccountSession = {
  id: string;
  sessionId?: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  image?: string | null;
};

type AccountSessionContextValue = {
  session: AccountSession | null;
  isSessionPending: boolean;
  isAccountServiceUnavailable: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AccountSessionContext = createContext<AccountSessionContextValue | null>(null);

export function AccountSessionProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error, refetch } = authClient.useSession();

  const session: AccountSession | null = data?.user
    ? {
        id: data.user.id,
        sessionId: data.session.id,
        displayName: data.user.name,
        email: data.user.email,
        emailVerified: data.user.emailVerified,
        twoFactorEnabled: data.user.twoFactorEnabled === true,
        image: safeProfilePhotoUrl(data.user.id, data.user.image),
      }
    : null;

  async function signOut() {
    const result = await authClient.signOut();
    if (result.error) throw new Error("Couldn’t sign out. Please try again.");
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistration("/")
        .then(async (registration) => {
          const notifications = await registration?.getNotifications();
          for (const notification of notifications ?? []) notification.close();
        })
        .catch(() => {});
    }
  }

  return (
    <AccountSessionContext.Provider
      value={{
        session,
        isSessionPending: isPending,
        isAccountServiceUnavailable: error?.status === 503,
        signOut,
        refreshSession: async () => {
          await refetch();
        },
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
