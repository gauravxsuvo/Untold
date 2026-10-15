import {
  backendErrorResponse,
  forbiddenOriginResponse,
  getAuthenticatedSession,
  readJsonBody,
  trustedBrowserOrigin,
  unauthorizedResponse,
} from "@/lib/server/http";
import { manageMfa, securityFailure, securityRequestBudget } from "@/lib/server/account-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) return unauthorizedResponse();
    const parsed = await readJsonBody(request, 4096);
    if (!parsed.ok || !parsed.body || typeof parsed.body !== "object") return securityFailure();
    const body = parsed.body as Record<string, unknown>;
    if (
      (body.action !== "disable" && body.action !== "regenerate") ||
      (body.method !== "totp" && body.method !== "backup") ||
      typeof body.password !== "string" ||
      typeof body.code !== "string" ||
      body.password.length > 128 ||
      body.code.length > 64
    )
      return securityFailure();
    const limited = await securityRequestBudget(request, "management", session.user.id);
    if (limited) return limited;
    const result = await manageMfa(
      session.user.id,
      session.session.token,
      body.password,
      body.method,
      body.code,
      body.action,
    );
    if (!result.ok) return securityFailure();
    return Response.json(
      { status: true, backupCodes: result.backupCodes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
