import { iceResponse } from "@/lib/server/ice-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep the old response shape for already open clients during rollout.
export const GET = (request: Request) => iceResponse(request, true);
