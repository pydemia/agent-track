import type { NextRequest } from "next/server"
import { readTrackContext } from "../../../../lib/track-context-server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const { sessionId } = await context.params
  return readTrackContext(request, sessionId, request.cookies.get("demian_access_token")?.value)
}
