import { getAuth } from "@/lib/auth/server";
import { accountAccess } from "@/lib/server/membership";
import { backendErrorResponse, unauthorizedResponse } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user) return unauthorizedResponse();
    return Response.json(await accountAccess(session.user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
