import { iceResponse } from "@/lib/server/ice-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => iceResponse(request);
