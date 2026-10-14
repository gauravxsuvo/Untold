import type { Metadata } from "next";
import { ApplicationShell } from "@/components/app/application-shell";

export const metadata: Metadata = {
  title: "Workspace — Untold",
  description: "Explore the Untold workspace. Conversation screens still use mock data.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
