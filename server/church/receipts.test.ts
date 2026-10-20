// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { ok } from "@/lib/result";
import { createDatabase, type Database } from "@/server/db/client";
import { churches, commandReceipts } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import type { ChurchSession } from "@/server/auth/session";

/**
 * The same command request, arriving twice, is done once — the case of a
 * phone whose first answer was lost on a weak signal. Run against the real
 * database, through the real route.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const CHURCH = `receipts-church-${process.pid}-${Date.now()}`;

let session: ChurchSession;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth/session", () => ({
  resolveChurchSession: async () => ok(session),
}));

const { POST } = await import("@/app/api/church/commands/route");

let db: Database;
let personId: string;

function send(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/church/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function taskCount(): Promise<number> {
  const repository = createPostgresSnapshotRepository({
    db,
    churchId: CHURCH,
    createSeed: () => createSeedSnapshot(new Date()),
  });
  return (await repository.load()).snapshot.tasks.length;
}

function createTask(requestId?: string) {
  return send({
    name: "task.create",
    input: { personId, type: "phone_call", assigneeId: session.teamMemberId },
    ...(requestId ? { requestId } : {}),
  });
}

describe.skipIf(!CONNECTION)("idempotent commands", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
    const repository = createPostgresSnapshotRepository({
      db,
      churchId: CHURCH,
      createSeed: () => createSeedSnapshot(new Date()),
    });
    const { snapshot } = await repository.load();
    const person = snapshot.people.find(
      (candidate) => candidate.visitor && candidate.contact.permissionGranted && !candidate.contact.optedOut,
    );
    personId = person!.id;
    session = {
      userId: `user-${CHURCH}`,
      churchId: CHURCH,
      role: "follow_up_coordinator",
      teamMemberId: snapshot.team.find((member) => member.role === "follow_up_coordinator")!.id,
      memberships: 1,
    };
  });

  afterAll(async () => {
    await db.delete(churches).where(eq(churches.id, CHURCH));
  });

  it("does the work once when the same request arrives twice, and answers the same both times", async () => {
    const before = await taskCount();

    const first = await createTask("retry-test-0001");
    const second = await createTask("retry-test-0001");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.data.notices).toEqual(firstBody.data.notices);
    expect(secondBody.data.data).toEqual(firstBody.data.data);
    expect(await taskCount()).toBe(before + 1);
  });

  it("does the work once when both copies arrive at the same moment", async () => {
    const before = await taskCount();
    const responses = await Promise.all([createTask("retry-test-0002"), createTask("retry-test-0002")]);

    // One ran; the other was either answered from it or told it is still saving.
    const statuses = responses.map((response) => response.status).sort();
    expect([[200, 200], [200, 409]]).toContainEqual(statuses);
    expect(await taskCount()).toBe(before + 1);
  });

  it("treats different request ids, and no id at all, as different requests", async () => {
    const before = await taskCount();
    await createTask("retry-test-0003");
    await createTask("retry-test-0004");
    await createTask();
    expect(await taskCount()).toBe(before + 3);
  });

  it("lets a refused request be tried again under the same id", async () => {
    const refused = await send({
      name: "task.create",
      input: { personId: "nobody", type: "phone_call", assigneeId: session.teamMemberId },
      requestId: "retry-test-0005",
    });
    expect(refused.status).toBe(404);
    const [receipt] = await db.select().from(commandReceipts).where(eq(commandReceipts.requestId, "retry-test-0005"));
    expect(receipt).toBeUndefined();

    const before = await taskCount();
    expect((await createTask("retry-test-0005")).status).toBe(200);
    expect(await taskCount()).toBe(before + 1);
  });

  it("refuses an id reused for a different command, and a malformed id", async () => {
    await createTask("retry-test-0006");
    const reused = await send({ name: "task.start", input: { taskId: "task_1" }, requestId: "retry-test-0006" });
    expect(reused.status).toBe(400);

    const malformed = await send({ name: "task.start", input: { taskId: "task_1" }, requestId: "no spaces!" });
    expect(malformed.status).toBe(400);
  });
});
