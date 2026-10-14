import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";
import { BackendConfigurationError } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  try {
    const handlers = toNextJsHandler(getAuth());
    const method = request.method as keyof typeof handlers;
    return handlers[method](request);
  } catch (error) {
    if (error instanceof BackendConfigurationError) {
      return Response.json(
        {
          code: "service_not_configured",
          message: "The account service is not configured yet. Please try again later.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.error("Untold authentication request failed", error);
    return Response.json(
      { code: "service_unavailable", message: "The service could not complete this request." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
