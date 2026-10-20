// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { requestBudgets } from "@/server/db/schema";
import { GET as lookUpInvitation } from "@/app/api/invitations/[token]/route";

/**
 * The public invitation lookup spends from a shared per-address budget, so a
 * script cannot sit guessing tokens. Run against the real database.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const RUN = `${process.pid}-${Date.now()}`;

function lookUp(address: string, token = "not-a-real-token") {
  return lookUpInvitation(
    new Request(`http://localhost/api/invitations/${token}`, { headers: { "x-forwarded-for": address } }),
    { params: Promise.resolve({ token }) },
  );
}

describe.skipIf(!CONNECTION)("invitation lookup budget", { timeout: 120_000 }, () => {
  afterAll(async () => {
    const db = createDatabase({ connectionString: CONNECTION as string, max: 1 });
    await db.delete(requestBudgets).where(like(requestBudgets.key, `invite-lookup:10.${RUN}%`));
  });

  it("answers thirty lookups from one address, then asks it to wait", async () => {
    const address = `10.${RUN}.1`;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const response = await lookUp(address);
      expect(response.status).toBe(404);
    }
    const refused = await lookUp(address);
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(await refused.json()).toMatchObject({ ok: false, code: "rate_limited", retryAfter });

    // Somebody else, on another connection, is unaffected.
    expect((await lookUp(`10.${RUN}.2`)).status).toBe(404);
  });
});
