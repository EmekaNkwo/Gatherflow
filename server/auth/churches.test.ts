// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSeedSnapshot } from "@/data/seed";
import { createDatabase, type Database } from "@/server/db/client";
import { churches, churchMembers, user } from "@/server/db/schema";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { getAuth } from "./auth";
import { CHURCH_COOKIE, churchCookie, listMemberships, readChurchCookie } from "./churches";
import { resolveChurchSession } from "./session";

/**
 * An account in more than one church. The choice is a cookie; the server
 * decides whether to honour it.
 */
const CONNECTION = process.env.TEST_DATABASE_URL;
const seed = () => createSeedSnapshot(new Date("2026-10-12T09:00:00.000Z"));

let db: Database;
const createdChurches: string[] = [];
const createdUsers: string[] = [];

async function church(suffix: string) {
  const churchId = `multi-church-${process.pid}-${suffix}`;
  createdChurches.push(churchId);
  await createPostgresSnapshotRepository({ db, churchId, createSeed: seed }).load();
  await db.update(churches).set({ name: `Church ${suffix}` }).where(eq(churches.id, churchId));
  return churchId;
}

async function signedInUser(suffix: string) {
  const email = `multi-${process.pid}-${suffix}@example.com`;
  const signUp = await getAuth().api.signUpEmail({
    body: { email, password: "correct-horse-battery-staple", name: "Multi Church" },
    asResponse: true,
  });
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  createdUsers.push(account.id);
  return { userId: account.id, cookie };
}

describe.skipIf(!CONNECTION)("church selection", { timeout: 60_000 }, () => {
  beforeAll(() => {
    db = createDatabase({ connectionString: CONNECTION as string, max: 4 });
  });

  afterAll(async () => {
    for (const id of createdChurches) await db.delete(churches).where(eq(churches.id, id));
    for (const id of createdUsers) await db.delete(user).where(eq(user.id, id));
  });

  it("asks for a choice, honours a valid one, and ignores an invalid one", async () => {
    const [a, b, other] = await Promise.all([church("a"), church("b"), church("other")]);
    const { userId, cookie } = await signedInUser("two");
    await db.insert(churchMembers).values([
      { churchId: a, userId, role: "administrator", teamMemberId: null },
      { churchId: b, userId, role: "volunteer", teamMemberId: null },
    ]);

    const memberships = await listMemberships(db, userId);
    expect(memberships.map((entry) => [entry.churchId, entry.churchName, entry.role])).toEqual([
      [a, "Church a", "administrator"],
      [b, "Church b", "volunteer"],
    ]);

    // No choice: refused, not guessed.
    const unchosen = await resolveChurchSession({ db, headers: new Headers({ cookie }) });
    expect(unchosen.ok).toBe(false);
    if (!unchosen.ok) expect(unchosen.code).toBe("church_required");

    // A choice the account is entitled to.
    const chosen = await resolveChurchSession({
      db,
      headers: new Headers({ cookie: `${cookie}; ${CHURCH_COOKIE}=${b}` }),
    });
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value).toMatchObject({ churchId: b, role: "volunteer", memberships: 2 });

    // A cookie naming a church they are not in: as if no choice were made.
    const forged = await resolveChurchSession({
      db,
      headers: new Headers({ cookie: `${cookie}; ${CHURCH_COOKIE}=${other}` }),
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.code).toBe("church_required");

    // An explicit church still wins over the cookie, and is still checked.
    const explicit = await resolveChurchSession({
      db,
      headers: new Headers({ cookie: `${cookie}; ${CHURCH_COOKIE}=${b}` }),
      churchId: a,
    });
    expect(explicit.ok && explicit.value.churchId).toBe(a);
    const denied = await resolveChurchSession({ db, headers: new Headers({ cookie }), churchId: other });
    expect(denied.ok).toBe(false);
  });

  it("needs no cookie for an account in exactly one church, and ignores a stale one", async () => {
    const [only, gone] = await Promise.all([church("only"), church("gone")]);
    const { userId, cookie } = await signedInUser("one");
    await db.insert(churchMembers).values({ churchId: only, userId, role: "pastor", teamMemberId: null });

    const plain = await resolveChurchSession({ db, headers: new Headers({ cookie }) });
    expect(plain.ok && plain.value).toMatchObject({ churchId: only, memberships: 1 });

    const stale = await resolveChurchSession({
      db,
      headers: new Headers({ cookie: `${cookie}; ${CHURCH_COOKIE}=${gone}` }),
    });
    expect(stale.ok && stale.value.churchId).toBe(only);
  });
});

describe("the church cookie", () => {
  it("round-trips through a cookie header and copes with odd values", () => {
    const set = churchCookie("church with spaces", true);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    const value = set.split(";")[0];
    expect(readChurchCookie(new Headers({ cookie: `other=1; ${value}; more=2` }))).toBe(
      "church with spaces",
    );
    expect(readChurchCookie(new Headers())).toBeNull();
    expect(readChurchCookie(new Headers({ cookie: `${CHURCH_COOKIE}=` }))).toBeNull();
    expect(readChurchCookie(new Headers({ cookie: `${CHURCH_COOKIE}=%E0%A4%A` }))).toBeNull();
    expect(churchCookie("x", false)).not.toContain("Secure");
  });
});
