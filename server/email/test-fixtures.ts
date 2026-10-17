import { expect } from "vitest";
import { createSeedSnapshot } from "@/data/seed";
import type { ChurchSession } from "@/server/auth/session";
import type { Database } from "@/server/db/client";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { createMailjetClient, type MailjetTransport } from "./mailjet";

/**
 * Shared fixtures for the email tests: a provider that answers as told and
 * records what it was asked, and a freshly seeded church with somebody who
 * may be emailed.
 */

export const NOW = new Date("2026-10-12T09:00:00.000Z");
export const seed = () => createSeedSnapshot(NOW);

/** The context a caller supplies for whichever template it chose. */
export const SEND_CONTEXT = {
  serviceName: "our Sunday service",
  serviceDate: "2026-10-11",
  groupName: "Tuesday connect group",
} as const;

export type ScriptedResponse = { status: number; body?: unknown } | "throw";

export interface RecordedCall {
  url: string;
  body: {
    Messages: Array<{
      To: Array<{ Email: string }>;
      Subject: string;
      TextPart: string;
      HTMLPart: string;
      CustomID: string;
      Headers: Record<string, string>;
    }>;
  };
}

/**
 * A provider that records what it was asked to do and answers from a script,
 * one entry per call, repeating the last entry once the script runs out.
 */
export function fakeTransport(responses: ScriptedResponse[]): {
  transport: MailjetTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const transport: MailjetTransport = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as RecordedCall["body"] });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response === "throw") throw new Error("socket hang up");
    return {
      status: response.status,
      json: async () =>
        response.body ?? {
          Messages: [
            {
              Status: "success",
              To: [{ Email: "x@example.com", MessageID: 123, MessageUUID: "uuid-1" }],
            },
          ],
        },
    };
  };

  return { transport, calls };
}

export function scriptedClient(responses: ScriptedResponse[] = [{ status: 200 }]) {
  const { transport, calls } = fakeTransport(responses);
  return {
    client: createMailjetClient(
      { apiKey: "key", secretKey: "secret", fromEmail: "hello@example.com", fromName: "Test" },
      transport,
    ),
    calls,
  };
}

/** Seeds a church and returns a contactable person plus an email template. */
export async function seededChurch(db: Database, churchId: string) {
  const repository = createPostgresSnapshotRepository({ db, churchId, createSeed: seed });
  const loaded = await repository.load();

  const person = loaded.snapshot.people.find(
    (candidate) =>
      candidate.contact.permissionGranted && !candidate.contact.optedOut && candidate.email,
  );
  expect(person, "the seed should contain a contactable person with an email").toBeDefined();

  const template = loaded.snapshot.templates.find((entry) => entry.channels.includes("email"));
  expect(template).toBeDefined();

  const session: ChurchSession = {
    userId: `user-${churchId}`,
    churchId,
    role: "follow_up_coordinator",
    teamMemberId: loaded.snapshot.team[0]?.id ?? null,
    memberships: 1,
  };

  return { churchId, repository, session, person: person!, template: template!, loaded };
}
