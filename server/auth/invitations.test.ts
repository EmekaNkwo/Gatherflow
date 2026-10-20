// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { createDatabase, type Database } from "@/server/db/client";
import { churches, churchMembers, user } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { getAuth } from "./auth";
import { createChurchForUser } from "./churches";
import {
  acceptInvitation,
  createInvitation,
  findOpenInvitation,
  listInvitations,
  revokeInvitation,
} from "./invitations";

/**
 * A church from nothing, and the people invited into it.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
let db: Database;
const createdChurches: string[] = [];
const createdUsers: string[] = [];

async function account(suffix: string) {
  const email = `invite-${process.pid}-${suffix}@example.com`;
  await getAuth().api.signUpEmail({
    body: { email, password: "correct-horse-battery-staple", name: `Person ${suffix}` },
  });
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  createdUsers.push(row.id);
  return { userId: row.id, email, name: `Person ${suffix}` };
}

describe.skipIf(!CONNECTION)("churches and invitations", { timeout: 60_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });
  afterAll(async () => {
    for (const id of createdChurches) await db.delete(churches).where(eq(churches.id, id));
    for (const id of createdUsers) await db.delete(user).where(eq(user.id, id));
  });

  it("creates an empty church with its founder as the only team member and administrator", async () => {
    const founder = await account("founder");
    const created = await createChurchForUser(db, {
      userId: founder.userId,
      userName: founder.name,
      churchName: "  New Life  ",
    });
    createdChurches.push(created.churchId);

    const loaded = await createPostgresSnapshotRepository({
      db,
      churchId: created.churchId,
      createSeed: () => {
        throw new Error("must not seed");
      },
    }).load(FULL_SCOPE);

    expect(loaded.snapshot.settings.churchName).toBe("New Life");
    expect(loaded.snapshot.people).toEqual([]);
    expect(loaded.snapshot.tasks).toEqual([]);
    expect(loaded.snapshot.team).toMatchObject([
      { id: created.teamMemberId, name: founder.name, role: "administrator", active: true },
    ]);
    expect(loaded.snapshot.templates.length).toBeGreaterThan(0);
    // Rules that default work to somebody point at the founder, not at a
    // demo team that does not exist here.
    for (const rule of loaded.snapshot.settings.automationRules) {
      if ("defaultAssigneeId" in rule && rule.defaultAssigneeId) {
        expect(rule.defaultAssigneeId).toBe(created.teamMemberId);
      }
    }

    const [membership] = await db
      .select({ role: churchMembers.role, teamMemberId: churchMembers.teamMemberId })
      .from(churchMembers)
      .where(eq(churchMembers.userId, founder.userId));
    expect(membership).toEqual({ role: "administrator", teamMemberId: created.teamMemberId });
  });

  it("invites by address, accepts only with that address, and creates a team member", async () => {
    const founder = await account("inviter");
    const { churchId } = await createChurchForUser(db, {
      userId: founder.userId,
      userName: founder.name,
      churchName: "Invite Church",
    });
    createdChurches.push(churchId);

    const invited = await createInvitation(db, {
      churchId,
      email: `Volunteer-Invited-${process.pid}@Example.com`,
      role: "volunteer",
      invitedBy: founder.userId,
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    expect((await listInvitations(db, churchId)).map((entry) => entry.email)).toEqual([
      `volunteer-invited-${process.pid}@example.com`,
    ]);

    // Somebody else holding the link cannot use it.
    const stranger = await account("stranger");
    const wrong = await acceptInvitation(db, invited.value.token, stranger);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("wrong_account");

    // The person it was sent to can, and becomes a team member in that role.
    // Unique per run, like every other account here: email addresses are
    // unique across the whole database, and two runs can overlap.
    const email = `volunteer-invited-${process.pid}@example.com`;
    await getAuth().api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Vol Unteer" },
    });
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    createdUsers.push(row.id);

    const accepted = await acceptInvitation(db, invited.value.token, { userId: row.id, email, name: "Vol Unteer" });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.role).toBe("volunteer");

    const loaded = await createPostgresSnapshotRepository({
      db,
      churchId,
      createSeed: () => {
        throw new Error("must not seed");
      },
    }).load(FULL_SCOPE);
    expect(loaded.snapshot.team.find((member) => member.id === accepted.value.teamMemberId)).toMatchObject({
      name: "Vol Unteer",
      role: "volunteer",
      active: true,
    });

    // Used once.
    const again = await findOpenInvitation(db, invited.value.token);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("used");
    expect(await listInvitations(db, churchId)).toEqual([]);
  });

  it("refuses a second open invitation, an existing member, and an already linked team member (M8)", async () => {
    const founder = await account("dupes");
    const { churchId, teamMemberId } = await createChurchForUser(db, {
      userId: founder.userId,
      userName: founder.name,
      churchName: "Duplicate Church",
    });
    createdChurches.push(churchId);

    const email = `dupe-${process.pid}@example.com`;
    const first = await createInvitation(db, { churchId, email, role: "volunteer", invitedBy: founder.userId });
    expect(first.ok).toBe(true);

    const second = await createInvitation(db, { churchId, email: email.toUpperCase(), role: "administrator", invitedBy: founder.userId });
    expect(second).toMatchObject({ ok: false, code: "duplicate" });

    const existing = await createInvitation(db, { churchId, email: founder.email, role: "pastor", invitedBy: founder.userId });
    expect(existing).toMatchObject({ ok: false, code: "already_member" });

    const linkedToFounder = await createInvitation(db, {
      churchId,
      email: `other-${process.pid}@example.com`,
      role: "pastor",
      teamMemberId,
      invitedBy: founder.userId,
    });
    expect(linkedToFounder).toMatchObject({ ok: false, code: "duplicate" });

    // Withdrawn, the address can be invited again.
    if (first.ok) await revokeInvitation(db, churchId, first.value.invitation.id);
    expect((await createInvitation(db, { churchId, email, role: "pastor", invitedBy: founder.userId })).ok).toBe(true);
  });

  it("gives an existing team member the invited role and switches them back on at accept (M8)", async () => {
    const founder = await account("relinker");
    const { churchId } = await createChurchForUser(db, {
      userId: founder.userId,
      userName: founder.name,
      churchName: "Relink Church",
    });
    createdChurches.push(churchId);

    // A team member who exists without an account: a volunteer, switched off.
    const repository = createPostgresSnapshotRepository({
      db,
      churchId,
      createSeed: () => {
        throw new Error("must not seed");
      },
    });
    const loaded = await repository.load(FULL_SCOPE);
    const volunteer = { id: `tm_relink_${process.pid}`, name: "Tunde B", role: "volunteer" as const, active: false, createdAt: new Date().toISOString() };
    const saved = await repository.save(loaded.snapshot, { ...loaded.snapshot, team: [...loaded.snapshot.team, volunteer] }, loaded.version);
    expect(saved.ok).toBe(true);

    const invitee = await account("relinked");
    const invited = await createInvitation(db, {
      churchId,
      email: invitee.email,
      role: "follow_up_coordinator",
      teamMemberId: volunteer.id,
      invitedBy: founder.userId,
    });
    if (!invited.ok) throw new Error(invited.error);

    const accepted = await acceptInvitation(db, invited.value.token, invitee);
    expect(accepted).toMatchObject({ ok: true, value: { teamMemberId: volunteer.id, role: "follow_up_coordinator" } });

    const after = await repository.load(FULL_SCOPE);
    expect(after.snapshot.team.find((member) => member.id === volunteer.id)).toMatchObject({
      role: "follow_up_coordinator",
      active: true,
    });
  });

  it("can be withdrawn, refuses the member role, and rejects an unknown token", async () => {
    const founder = await account("revoker");
    const { churchId } = await createChurchForUser(db, {
      userId: founder.userId,
      userName: founder.name,
      churchName: "Revoke Church",
    });
    createdChurches.push(churchId);

    const invited = await createInvitation(db, { churchId, email: "x@example.com", role: "pastor", invitedBy: founder.userId });
    if (!invited.ok) throw new Error(invited.error);
    expect(await revokeInvitation(db, churchId, invited.value.invitation.id)).toEqual({ email: "x@example.com", role: "pastor" });
    expect((await findOpenInvitation(db, invited.value.token)).ok).toBe(false);

    const member = await createInvitation(db, { churchId, email: "m@example.com", role: "member", invitedBy: founder.userId });
    expect(member.ok).toBe(false);

    expect((await findOpenInvitation(db, "nope")).ok).toBe(false);
  });
});
