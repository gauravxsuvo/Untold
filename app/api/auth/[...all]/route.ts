import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";
import { BackendConfigurationError } from "@/lib/server/database";
import { forbiddenOriginResponse, readJsonBody, trustedBrowserOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  try {
    if (
      request.method === "POST" &&
      new URL(request.url).pathname.startsWith("/api/auth/two-factor/")
    ) {
      if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
      const parsed = await readJsonBody(request, 4096);
      if (!parsed.ok)
        return Response.json(
          { message: "Check your details and try again." },
          { status: parsed.status, headers: { "Cache-Control": "no-store" } },
        );
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      request = new Request(request, { headers, body: JSON.stringify(parsed.body) });
    }
    const handlers = toNextJsHandler(getAuth());
    const method = request.method as keyof typeof handlers;
    const response = await handlers[method](request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof BackendConfigurationError) {
      return Response.json(
        {
          code: "service_unavailable",
          message: "Untold isn’t available right now. Please try again in a moment.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.error("Untold authentication request failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      {
        code: "service_unavailable",
        message: "Untold isn’t available right now. Please try again in a moment.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
