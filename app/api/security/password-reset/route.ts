import {
  backendErrorResponse,
  forbiddenOriginResponse,
  readJsonBody,
  trustedBrowserOrigin,
} from "@/lib/server/http";
import {
  resetPasswordWithRecoveryCode,
  securityFailure,
  securityRequestBudget,
} from "@/lib/server/account-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!trustedBrowserOrigin(request)) return forbiddenOriginResponse();
  try {
    const parsed = await readJsonBody(request, 4096);
    if (!parsed.ok || !parsed.body || typeof parsed.body !== "object") return securityFailure();
    const body = parsed.body as Record<string, unknown>;
    if (
      typeof body.email !== "string" ||
      typeof body.code !== "string" ||
      typeof body.newPassword !== "string"
    )
      return securityFailure();
    const email = body.email.trim().toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      body.code.length > 64 ||
      body.newPassword.length < 15 ||
      body.newPassword.length > 128
    )
      return securityFailure();
    const limited = await securityRequestBudget(request, "recovery", email);
    if (limited) return limited;
    const ok = await resetPasswordWithRecoveryCode(email, body.code, body.newPassword);
    if (!ok) return securityFailure();
    return Response.json({ status: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
