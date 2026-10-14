"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

export type PreviewSession = {
  displayName: string;
  email: string;
  emailVerified: boolean;
  source: "demo" | "account";
};

type PreviewAuthContextValue = {
  session: PreviewSession | null;
  isSessionPending: boolean;
  isAccountServiceUnavailable: boolean;
  beginDemoSession: () => void;
  signOut: () => Promise<void>;
};

const PreviewAuthContext = createContext<PreviewAuthContextValue | null>(null);

export function PreviewAuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error } = authClient.useSession();
  const [demoSession, setDemoSession] = useState<PreviewSession | null>(null);

  const session: PreviewSession | null = data?.user
    ? {
        displayName: data.user.name,
        email: data.user.email,
        emailVerified: data.user.emailVerified,
        source: "account",
      }
    : demoSession;

  function beginDemoSession() {
    if (data?.user) return;
    setDemoSession({
      displayName: "Mira Chen",
      email: "mira@untold.example",
      emailVerified: false,
      source: "demo",
    });
  }

  async function signOut() {
    if (data?.user) {
      setDemoSession(null);
      await authClient.signOut();
      return;
    }

    setDemoSession(null);
  }

  return (
    <PreviewAuthContext.Provider
      value={{
        session,
        isSessionPending: isPending,
        isAccountServiceUnavailable: error?.status === 503,
        beginDemoSession,
        signOut,
      }}
    >
      {children}
    </PreviewAuthContext.Provider>
  );
}

export function usePreviewAuth() {
  const value = useContext(PreviewAuthContext);
  if (!value) {
    throw new Error("usePreviewAuth must be used inside PreviewAuthProvider.");
  }
  return value;
}
