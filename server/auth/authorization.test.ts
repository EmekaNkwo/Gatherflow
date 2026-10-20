// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { createFollowUpTask } from "@/services/follow-ups/tasks";
import type { PersonId } from "@/types/common";
import type { DemoRole } from "@/types/team";
import { createDatabase, type Database } from "@/server/db/client";
import { churchMembers, churches, user } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { readChurch, runCommand } from "@/server/church/commands";
import { commandFor } from "@/services/commands/registry";
import { authorize, FORBIDDEN, scopeFor } from "./authorize";
import { resolveChurchSession, type ChurchSession } from "./session";
import { getAuth } from "./auth";

/**
 * Authorisation, against a real database.
 *
 * The point of these tests is that the refusals are the server's, not the
 * interface's: every case here bypasses the UI entirely and calls the server
 * path directly, which is exactly what a hostile client would do.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-12T09:00:00.000Z");
const seed = () => createSeedSnapshot(NOW);

let db: Database;
let counter = 0;
const createdChurches: string[] = [];
const createdUsers: string[] = [];

function nextChurchId(): string {
  counter += 1;
  const id = `authz-church-${process.pid}-${counter}`;
  createdChurches.push(id);
  return id;
}

/** Seeds a church and returns it with a session for the given role. */
async function churchWithSession(
  role: DemoRole,
  options: { teamMemberId?: string | null } = {},
) {
  const churchId = nextChurchId();
  const repository = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
  const loaded = await repository.load();

  const teamMemberId =
    options.teamMemberId === undefined
      ? (loaded.snapshot.team[0]?.id ?? null)
      : options.teamMemberId;

  const session: ChurchSession = {
    userId: `user-${churchId}`,
    churchId,
    role,
    teamMemberId,
    memberships: 1,
  };

  return { churchId, session, snapshot: loaded.snapshot, repository };
}

describe.skipIf(!CONNECTION)("server-side authorisation", () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });

  afterAll(async () => {
    for (const id of createdChurches) {
      await db.delete(churches).where(eq(churches.id, id));
    }
    for (const id of createdUsers) {
      await db.delete(user).where(eq(user.id, id));
    }
  });

  describe("the capability map is shared with the interface", () => {
    it("permits what the role allows and refuses what it does not", async () => {
      const admin = await churchWithSession("administrator");
      const volunteer = await churchWithSession("volunteer");

      expect(authorize(admin.session, "settings.write").ok).toBe(true);

      const refused = authorize(volunteer.session, "settings.write");
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe(FORBIDDEN);
    });

    it("gives a member no capabilities at all", async () => {
      const { session } = await churchWithSession("member");
      for (const capability of ["people.read", "tasks.write", "analytics.read"] as const) {
        expect(authorize(session, capability).ok).toBe(false);
      }
    });
  });

  describe("a volunteer acts only on their own work", () => {
    /** Runs a registry command exactly as the commands route does. */
    async function send(session: ChurchSession, name: "task.reschedule" | "visitor.closeFollowUp", input: object) {
      const definition = commandFor(name);
      const parsed = definition.schema.parse(input);
      return runCommand(
        { db, session },
        definition.capability,
        (snap, ctx) => definition.run(snap, parsed, ctx),
        (snap, me) => definition.ownedBy!(snap, parsed, me),
      );
    }

    it("refuses another volunteer's task and allows their own", async () => {
      const { session, snapshot } = await churchWithSession("volunteer", { teamMemberId: "tm_vol_amara" });
      const me = session.teamMemberId as string;
      const open = snapshot.tasks.filter((task) => task.status === "pending" || task.status === "in_progress");
      const theirs = open.find((task) => task.assigneeId && task.assigneeId !== me);
      const mine = open.find((task) => task.assigneeId === me);
      expect(theirs && mine).toBeTruthy();

      const refused = await send(session, "task.reschedule", { taskId: theirs!.id, dueDate: "2026-12-01" });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe(FORBIDDEN);

      const allowed = await send(session, "task.reschedule", { taskId: mine!.id, dueDate: "2026-12-01" });
      expect(allowed.ok).toBe(true);
    });

    it("refuses to stop following up somebody another volunteer looks after", async () => {
      const { session, snapshot } = await churchWithSession("volunteer", { teamMemberId: "tm_vol_amara" });
      const me = session.teamMemberId as string;
      const someoneElses = snapshot.people.find(
        (person) =>
          person.visitor?.assignedTo &&
          person.visitor.assignedTo !== me &&
          !snapshot.tasks.some((task) => task.personId === person.id && task.assigneeId === me),
      );
      expect(someoneElses).toBeDefined();

      const refused = await send(session, "visitor.closeFollowUp", { personId: someoneElses!.id, reason: "paused" });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe(FORBIDDEN);
    });

    it("lets a coordinator act on anybody's work", async () => {
      const { session, snapshot } = await churchWithSession("follow_up_coordinator");
      const anyOpen = snapshot.tasks.find(
        (task) => task.assigneeId !== session.teamMemberId && task.status === "pending",
      );
      const outcome = await send(session, "task.reschedule", { taskId: anyOpen!.id, dueDate: "2026-12-01" });
      expect(outcome.ok).toBe(true);
    });
  });

  describe("read scope", () => {
    it("keeps pastoral care from an administrator, and allows a pastor", async () => {
      // Deliberate: configuring the system and reading people's care notes are
      // different jobs. This is the rule most likely to be "fixed" by mistake.
      const admin = await churchWithSession("administrator");
      const pastor = await churchWithSession("pastor");
      const volunteer = await churchWithSession("volunteer");

      expect(scopeFor(admin.session).careRecords).toBe(false);
      expect(scopeFor(pastor.session).careRecords).toBe(true);
      expect(scopeFor(volunteer.session).careRecords).toBe(false);
    });

    it("scopes a volunteer to their own tasks, and fails closed with no team member", async () => {
      const linked = await churchWithSession("volunteer");
      expect(scopeFor(linked.session).tasks).toEqual({
        assigneeId: linked.session.teamMemberId,
      });

      const unlinked = await churchWithSession("volunteer", { teamMemberId: null });
      expect(scopeFor(unlinked.session).tasks).toBe("none");
    });

    it("returns no care rows to a volunteer and rows to a pastor, from the database", async () => {
      const pastor = await churchWithSession("pastor");
      expect(pastor.snapshot.careRecords.length).toBeGreaterThan(0);

      const pastorRead = await readChurch({ db, session: pastor.session });
      expect(pastorRead.snapshot.careRecords.length).toBeGreaterThan(0);

      const volunteerSession: ChurchSession = { ...pastor.session, role: "volunteer" };
      const volunteerRead = await readChurch({ db, session: volunteerSession });
      expect(volunteerRead.snapshot.careRecords).toEqual([]);
    });

    it("sends emergency contacts and restricted timeline entries only to roles that read pastoral care", async () => {
      const pastor = await churchWithSession("pastor");
      const restrictedInSeed = pastor.snapshot.activity.filter((entry) => entry.visibility === "restricted").length;
      const contactsInSeed = pastor.snapshot.people.filter((person) => person.member?.emergencyContact).length;
      expect(restrictedInSeed).toBeGreaterThan(0);
      expect(contactsInSeed).toBeGreaterThan(0);

      const pastorRead = await readChurch({ db, session: pastor.session });
      expect(pastorRead.snapshot.activity.filter((entry) => entry.visibility === "restricted")).toHaveLength(
        restrictedInSeed,
      );
      expect(pastorRead.snapshot.people.filter((person) => person.member?.emergencyContact)).toHaveLength(contactsInSeed);

      // A volunteer reads the history of their own follow-ups only.
      const volunteerRead = await readChurch({ db, session: { ...pastor.session, role: "volunteer", teamMemberId: "tm_vol_amara" } });
      const theirTasks = new Set(volunteerRead.snapshot.tasks.map((task) => task.id));
      const taskEntries = volunteerRead.snapshot.activity.filter((entry) => entry.meta?.taskId);
      expect(taskEntries.length).toBeGreaterThan(0);
      expect(taskEntries.every((entry) => theirTasks.has(entry.meta!.taskId))).toBe(true);

      for (const role of ["administrator", "follow_up_coordinator", "volunteer"] as const) {
        const read = await readChurch({ db, session: { ...pastor.session, role } });
        expect(read.snapshot.activity.some((entry) => entry.visibility === "restricted"), role).toBe(false);
        expect(read.snapshot.people.some((person) => person.member?.emergencyContact), role).toBe(false);
        // Everything else about the people is still there.
        expect(read.snapshot.people).toHaveLength(pastor.snapshot.people.length);
      }
    });

    it("returns only a volunteer's own tasks, from the database", async () => {
      const { session, snapshot } = await churchWithSession("volunteer");
      const assignee = session.teamMemberId as string;

      const everyTask = snapshot.tasks.length;
      const theirs = snapshot.tasks.filter((task) => task.assigneeId === assignee).length;
      expect(theirs).toBeGreaterThan(0);
      expect(theirs).toBeLessThan(everyTask);

      const read = await readChurch({ db, session });
      expect(read.snapshot.tasks.length).toBe(theirs);
      expect(read.snapshot.tasks.every((task) => task.assigneeId === assignee)).toBe(true);
    });

    it("gives a member no tasks at all", async () => {
      const { session } = await churchWithSession("member");
      const read = await readChurch({ db, session });
      expect(read.snapshot.tasks).toEqual([]);
    });
  });

  describe("commands", () => {
    it("refuses a command the role lacks, and changes nothing", async () => {
      const { session, snapshot, churchId } = await churchWithSession("member");
      const person = snapshot.people[0];

      const outcome = await runCommand({ db, session }, "tasks.write", (snap, ctx) =>
        createFollowUpTask(
          snap,
          { personId: person.id as PersonId, type: "welcome_message" },
          ctx,
        ),
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe(FORBIDDEN);

      const after = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
      expect((await after.load()).snapshot.tasks.length).toBe(snapshot.tasks.length);
    });

    it("runs and persists a command the role allows", async () => {
      const { session, snapshot, churchId } = await churchWithSession(
        "follow_up_coordinator",
      );
      // Somebody who can be contacted, so the command is not refused on consent.
      const person = snapshot.people.find(
        (candidate) => candidate.contact.permissionGranted && !candidate.contact.optedOut,
      );
      expect(person).toBeDefined();

      const outcome = await runCommand({ db, session }, "tasks.write", (snap, ctx) =>
        createFollowUpTask(
          snap,
          { personId: person!.id as PersonId, type: "welcome_message" },
          ctx,
        ),
      );

      expect(outcome.ok).toBe(true);

      const after = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
      const reloaded = await after.load();
      expect(reloaded.snapshot.tasks.length).toBeGreaterThan(snapshot.tasks.length);
      expect(reloaded.version).toBeGreaterThan(1);
    });

    it("runs commands against the full church even when the caller reads a narrow slice", async () => {
      // A volunteer reads only their own tasks, but the duplicate-automationKey
      // rule has to see every task or it would create a second welcome task.
      const { session, snapshot, churchId } = await churchWithSession("volunteer");
      const automated = snapshot.tasks.find((task) => task.automationKey);
      expect(automated).toBeDefined();

      const outcome = await runCommand({ db, session }, "tasks.write", (snap, ctx) =>
        createFollowUpTask(
          snap,
          {
            personId: automated!.personId as PersonId,
            type: automated!.type,
            automationKey: automated!.automationKey,
          },
          ctx,
        ),
      );

      // Refused as a duplicate, which is only possible if the command saw a
      // task the volunteer is not allowed to read.
      expect(outcome.ok).toBe(false);

      const after = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
      expect((await after.load()).snapshot.tasks.length).toBe(snapshot.tasks.length);
    });

    it("records the acting team member on what it creates", async () => {
      const { session, snapshot } = await churchWithSession("follow_up_coordinator");
      const person = snapshot.people.find(
        (candidate) => candidate.contact.permissionGranted && !candidate.contact.optedOut,
      );

      const outcome = await runCommand({ db, session }, "tasks.write", (snap, ctx) =>
        createFollowUpTask(
          snap,
          { personId: person!.id as PersonId, type: "check_in" },
          ctx,
        ),
      );

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const created = outcome.value.snapshot.tasks.find(
          (task) => task.createdBy === session.teamMemberId,
        );
        expect(created).toBeDefined();
      }
    });
  });

  describe("church isolation", () => {
    it("reads nothing from another church with the same session", async () => {
      const a = await churchWithSession("administrator");
      const b = await churchWithSession("administrator");

      const renamed = {
        ...b.snapshot,
        settings: { ...b.snapshot.settings, churchName: "Church B Only" },
      };
      await b.repository.save(b.snapshot, renamed, 1);

      // Session A names church A; there is no way to ask it for church B.
      const read = await readChurch({ db, session: a.session });
      expect(read.snapshot.settings.churchName).not.toBe("Church B Only");
    });
  });

  describe("session resolution", () => {
    it("refuses when there is no auth session", async () => {
      const outcome = await resolveChurchSession({ db, headers: new Headers() });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("unauthenticated");
    });

    it("resolves role and team member from the membership row, not the request", async () => {
      const churchId = nextChurchId();
      const repository = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
      const loaded = await repository.load();
      const teamMemberId = loaded.snapshot.team[0].id;

      const email = `volunteer-${process.pid}-${counter}@example.com`;
      const signUp = await getAuth().api.signUpEmail({
        body: { email, password: "correct-horse-battery-staple", name: "Test Volunteer" },
        asResponse: true,
      });
      expect(signUp.status).toBeLessThan(400);

      const cookies = signUp.headers.getSetCookie();
      expect(cookies.length).toBeGreaterThan(0);
      const cookieHeader = cookies.map((value) => value.split(";")[0]).join("; ");

      const [account] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
      createdUsers.push(account.id);

      await db.insert(churchMembers).values({
        churchId,
        userId: account.id,
        role: "volunteer",
        teamMemberId,
      });

      const resolved = await resolveChurchSession({
        db,
        headers: new Headers({ cookie: cookieHeader }),
      });

      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.value.userId).toBe(account.id);
        expect(resolved.value.churchId).toBe(churchId);
        expect(resolved.value.role).toBe("volunteer");
        expect(resolved.value.teamMemberId).toBe(teamMemberId);
      }
    });

    it("refuses a signed-in account with no church membership", async () => {
      const email = `orphan-${process.pid}-${counter}@example.com`;
      const signUp = await getAuth().api.signUpEmail({
        body: { email, password: "correct-horse-battery-staple", name: "No Church" },
        asResponse: true,
      });
      const cookieHeader = signUp.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");

      const [account] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
      createdUsers.push(account.id);

      const resolved = await resolveChurchSession({
        db,
        headers: new Headers({ cookie: cookieHeader }),
      });

      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.code).toBe("no_membership");
    });
  });
});
