// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { visitCount } from "@/services/attendance/visits";
import { createDatabase, type Database } from "@/server/db/client";
import { churches } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { POST } from "@/app/api/ops/repair-visits/route";
import type { Person } from "@/types/person";

/**
 * The operator repair of first-visit records saved before the fix, against
 * the real database: report first, then repair, and a second run finds
 * nothing to do.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const CHURCH = `repair-church-${process.pid}-${Date.now()}`;
const SECRET = "repair-test-secret";
const BROKEN_ID = "person_repair_broken";

let db: Database;

function repository() {
  return createPostgresSnapshotRepository({ db, churchId: CHURCH, createSeed: () => createSeedSnapshot(new Date()) });
}

function call(query: string) {
  return POST(
    new Request(`http://localhost/api/ops/repair-visits?${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
}

describe.skipIf(!CONNECTION)("repairing stored first visits", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET;
    db = createDatabase({ connectionString: CONNECTION as string, max: 2 });

    // A visitor saved the old way: welcomed on Sunday's service on Monday,
    // with Monday stored as their first visit.
    const loaded = await repository().load();
    const sunday = [...loaded.snapshot.sessions].sort((a, b) => b.date.localeCompare(a.date))[0];
    const template = loaded.snapshot.people.find((person) => person.kind === "visitor" && person.visitor)!;
    const registeredAt = `${sunday.date}T23:59:00.000Z`;
    const monday = new Date(Date.parse(`${sunday.date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    const broken: Person = {
      ...template,
      id: BROKEN_ID,
      firstName: "Repair",
      lastName: "Candidate",
      email: "repair.candidate@example.com",
      phone: "+44 7700 555000",
      householdId: undefined,
      groupIds: [],
      member: undefined,
      createdAt: registeredAt,
      updatedAt: registeredAt,
      visitor: { ...template.visitor!, firstVisitDate: monday, returningVisitor: undefined },
    };
    const next = {
      ...loaded.snapshot,
      people: [...loaded.snapshot.people, broken],
      attendance: [
        ...loaded.snapshot.attendance,
        {
          id: "attendance_repair_broken",
          sessionId: sunday.id,
          personId: BROKEN_ID,
          method: "search" as const,
          status: "present" as const,
          recordedAt: registeredAt,
          recordedBy: loaded.snapshot.team[0].id,
          firstVisit: false,
          corrections: [],
        },
      ],
    };
    const saved = await repository().save(loaded.snapshot, next, loaded.version);
    expect(saved.ok).toBe(true);
  });

  afterAll(async () => {
    await db.delete(churches).where(eq(churches.id, CHURCH));
  });

  it("reports on a dry run and saves nothing", async () => {
    const response = await call(`church=${CHURCH}&dryRun=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const [report] = body.data.churches;
    expect(report.correctedDates).toEqual([expect.stringMatching(/^Repair Candidate: /)]);
    expect(report.saved).toBe(false);

    const { snapshot } = await repository().load();
    expect(visitCount(snapshot, BROKEN_ID)).toBe(2);
  });

  it("repairs the record, and a second run finds nothing to do", async () => {
    const response = await call(`church=${CHURCH}`);
    const [report] = (await response.json()).data.churches;
    expect(report.saved).toBe(true);

    const { snapshot } = await repository().load();
    const person = snapshot.people.find((entry) => entry.id === BROKEN_ID)!;
    const row = snapshot.attendance.find((entry) => entry.id === "attendance_repair_broken")!;
    const sundayDate = snapshot.sessions.find((session) => session.id === row.sessionId)!.date;
    expect(person.visitor?.firstVisitDate).toBe(sundayDate);
    expect(visitCount(snapshot, BROKEN_ID)).toBe(1);
    expect(row.firstVisit).toBe(true);

    const again = (await (await call(`church=${CHURCH}`)).json()).data.churches[0];
    expect(again).toMatchObject({ correctedDates: [], correctedFlags: 0, saved: false });
  });

  it("refuses an unknown church rather than creating one, and hides from a caller without the secret", async () => {
    const missing = await call("church=no-such-church&dryRun=1");
    expect(missing.status).toBe(404);
    const [created] = await db.select().from(churches).where(eq(churches.id, "no-such-church"));
    expect(created).toBeUndefined();

    const anonymous = await POST(new Request("http://localhost/api/ops/repair-visits", { method: "POST" }));
    expect(anonymous.status).toBe(404);
  });
});
