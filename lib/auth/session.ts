import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/server";
import { BackendConfigurationError } from "@/lib/server/database";

export type ServerSessionState =
  | { status: "signed-in"; user: { id: string; name: string; email: string } }
  | { status: "signed-out" }
  | { status: "unavailable" };

export async function getServerSession(): Promise<ServerSessionState> {
  // Read request headers outside the try block: during a build, headers() throws Next's internal
  // "this route is dynamic" signal, which must propagate instead of being treated as an auth failure.
  const requestHeaders = await headers();

  try {
    const session = await getAuth().api.getSession({ headers: requestHeaders });
    if (!session?.user) return { status: "signed-out" };
    const { id, name, email } = session.user;
    return { status: "signed-in", user: { id, name, email } };
  } catch (error) {
    if (!(error instanceof BackendConfigurationError)) {
      console.error("Untold session lookup failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return { status: "unavailable" };
  }
}
