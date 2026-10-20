// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { toIsoDate } from "@/lib/dates";
import { recordAttendance } from "@/services/attendance/check-in";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { createDatabase, type Database } from "@/server/db/client";
import { churches } from "@/server/db/schema";
import type { ChurchSession } from "@/server/auth/session";
import { readChurch, runCommand, type ChurchContext } from "./commands";

/**
 * The server command path against a real Postgres. Runs only when
 * TEST_DATABASE_URL is set, like the repository tests.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;

let db: Database;
const churchId = `test-commands-${process.pid}`;

function contextFor(): ChurchContext {
  const session: ChurchSession = {
    userId: "user-test",
    churchId,
    role: "administrator",
    teamMemberId: null,
    memberships: 1,
  };
  return { db, session };
}

describe.skipIf(!CONNECTION)("runCommand under concurrent check-ins", () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 10 });
  });

  afterAll(async () => {
    await db.delete(churches).where(eq(churches.id, churchId));
  });

  it("lets ten simultaneous check-ins for different people all succeed", async () => {
    const context = contextFor();
    const { snapshot } = await readChurch(context);
    const today = toIsoDate(new Date());
    const session = [...snapshot.sessions]
      .filter((entry) => entry.date <= today)
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    expect(session).toBeDefined();

    const here = new Set(
      snapshot.attendance.filter((row) => row.sessionId === session.id).map((row) => row.personId),
    );
    const people = snapshot.people.filter((person) => !here.has(person.id)).slice(0, 10);
    expect(people).toHaveLength(10);

    const outcomes = await Promise.all(
      people.map((person) =>
        runCommand(context, "attendance.write", (current, ctx) =>
          recordAttendance(current, { sessionId: session.id, personId: person.id }, ctx),
        ),
      ),
    );

    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);

    const reloaded = await readChurch({ ...context });
    const present = reloaded.snapshot.attendance.filter(
      (row) =>
        row.sessionId === session.id &&
        row.status === "present" &&
        people.some((person) => person.id === row.personId),
    );
    expect(present).toHaveLength(10);
    expect(FULL_SCOPE).toBeDefined();
  }, 60_000);
});
