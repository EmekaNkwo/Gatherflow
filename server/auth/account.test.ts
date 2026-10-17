// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { createDatabase, type Database } from "@/server/db/client";
import { auditLog, churches, churchMembers, invitations, user } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { deletionBlockers, leaveChurches, retireAccount } from "./account";
import { getAuth } from "./auth";
import { createChurchForUser } from "./churches";
import { acceptInvitation, createInvitation } from "./invitations";

/**
 * An account leaving: refused while it is the only administrator of a
 * church, and otherwise leaving its team members in place, inactive, so the
 * church's history keeps its attribution.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const PASSWORD = "correct-horse-battery-staple";
let db: Database;
const createdChurches: string[] = [];
const createdUsers: string[] = [];

async function account(suffix: string) {
  const email = `account-${process.pid}-${suffix}@example.com`;
  await getAuth().api.signUpEmail({ body: { email, password: PASSWORD, name: `Person ${suffix}` } });
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  createdUsers.push(row.id);
  return { userId: row.id, email, name: `Person ${suffix}` };
}

async function church(founder: { userId: string; name: string }, name: string) {
  const created = await createChurchForUser(db, { userId: founder.userId, userName: founder.name, churchName: name });
  createdChurches.push(created.churchId);
  return created;
}

async function join(churchId: string, invitedBy: string, person: Awaited<ReturnType<typeof account>>, role: "administrator" | "volunteer") {
  const invited = await createInvitation(db, { churchId, email: person.email, role, invitedBy });
  if (!invited.ok) throw new Error(invited.error);
  const accepted = await acceptInvitation(db, invited.value.token, person);
  if (!accepted.ok) throw new Error(accepted.error);
  return accepted.value.teamMemberId;
}

async function team(churchId: string) {
  const loaded = await createPostgresSnapshotRepository({
    db,
    churchId,
    createSeed: () => {
      throw new Error("must not seed");
    },
  }).load(FULL_SCOPE);
  return loaded.snapshot.team;
}

describe.skipIf(!CONNECTION)("account deletion", { timeout: 60_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });
  afterAll(async () => {
    for (const id of createdChurches) await db.delete(churches).where(eq(churches.id, id));
    for (const id of createdUsers) await db.delete(user).where(eq(user.id, id));
  });

  it("names every church the account is the only administrator of", async () => {
    const founder = await account("solo");
    await church(founder, "Solo Chapel");
    const helper = await account("helper");
    const shared = await church(founder, "Shared Chapel");
    await join(shared.churchId, founder.userId, helper, "volunteer");

    expect((await deletionBlockers(db, founder.userId)).sort()).toEqual(["Shared Chapel", "Solo Chapel"]);
    // A volunteer is never the one keeping a church open.
    expect(await deletionBlockers(db, helper.userId)).toEqual([]);
  });

  it("allows it once another administrator exists, and retires the account's team members", async () => {
    const founder = await account("leaving");
    const { churchId, teamMemberId } = await church(founder, "Handover Chapel");
    const successor = await account("successor");
    await join(churchId, founder.userId, successor, "administrator");

    expect(await deletionBlockers(db, founder.userId)).toEqual([]);
    const pending = await createInvitation(db, { churchId, email: "later@example.com", role: "administrator", invitedBy: founder.userId });
    expect(pending.ok).toBe(true);

    const left = await leaveChurches(db, founder.userId);
    if (!left.ok) throw new Error(left.error);
    await retireAccount(db, founder.userId, left.value);

    // Out of the church, and the invitation they sent can no longer be used.
    expect(await db.select().from(churchMembers).where(eq(churchMembers.userId, founder.userId))).toEqual([]);
    expect(await db.select().from(invitations).where(eq(invitations.invitedBy, founder.userId))).toEqual([]);

    const founderMember = (await team(churchId)).find((member) => member.id === teamMemberId);
    expect(founderMember).toMatchObject({ active: false, name: founder.name });
    const audit = await db
      .select({ action: auditLog.action, userId: auditLog.userId, targetId: auditLog.targetId })
      .from(auditLog)
      .where(and(eq(auditLog.churchId, churchId), eq(auditLog.action, "account.delete")));
    expect(audit).toEqual([{ action: "account.delete", userId: founder.userId, targetId: teamMemberId }]);
  });

  it("never lets two administrators leave a church empty by leaving at the same moment", async () => {
    const first = await account("race-a");
    const { churchId } = await church(first, "Race Chapel");
    const second = await account("race-b");
    await join(churchId, first.userId, second, "administrator");

    const outcomes = await Promise.all([leaveChurches(db, first.userId), leaveChurches(db, second.userId)]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const admins = await db
      .select({ userId: churchMembers.userId })
      .from(churchMembers)
      .where(and(eq(churchMembers.churchId, churchId), eq(churchMembers.role, "administrator")));
    expect(admins).toHaveLength(1);
  });

  it("is enforced on the delete itself, and asks for the password", async () => {
    const founder = await account("guarded");
    await church(founder, "Guarded Chapel");
    const signedIn = await getAuth().api.signInEmail({
      body: { email: founder.email, password: PASSWORD },
      returnHeaders: true,
    });
    const headers = new Headers({ cookie: signedIn.headers.get("set-cookie")?.split(";")[0] ?? "" });

    await expect(getAuth().api.deleteUser({ body: { password: PASSWORD }, headers })).rejects.toThrow(
      /only administrator of Guarded Chapel/,
    );
    await expect(getAuth().api.deleteUser({ body: {}, headers })).rejects.toThrow(/password/i);
    const [still] = await db.select({ id: user.id }).from(user).where(eq(user.id, founder.userId));
    expect(still).toBeDefined();
  });

  it("deletes a volunteer's account and leaves the church its history", async () => {
    const founder = await account("keeper");
    const { churchId } = await church(founder, "Keeper Chapel");
    const volunteer = await account("departing");
    const teamMemberId = await join(churchId, founder.userId, volunteer, "volunteer");

    const signedIn = await getAuth().api.signInEmail({
      body: { email: volunteer.email, password: PASSWORD },
      returnHeaders: true,
    });
    const headers = new Headers({ cookie: signedIn.headers.get("set-cookie")?.split(";")[0] ?? "" });
    await getAuth().api.deleteUser({ body: { password: PASSWORD }, headers });

    expect(await db.select().from(user).where(eq(user.id, volunteer.userId))).toEqual([]);
    expect(
      await db.select().from(churchMembers).where(eq(churchMembers.userId, volunteer.userId)),
    ).toEqual([]);
    expect((await team(churchId)).find((member) => member.id === teamMemberId)).toMatchObject({ active: false });
  });
});
