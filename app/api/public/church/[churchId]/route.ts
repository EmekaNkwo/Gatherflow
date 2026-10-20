import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { churches } from "@/server/db/schema";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * The one public fact about a church: its name, so the welcome page can
 * greet people properly. Nothing else — no sessions, no people, no team.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ churchId: string }> },
): Promise<Response> {
  const { churchId } = await params;
  const [row] = await getDatabase()
    .select({ name: churches.name })
    .from(churches)
    .where(eq(churches.id, churchId));
  if (!row) return respondErr("That welcome link is not valid.", "not_found");
  return respondOk({ name: row.name });
}
