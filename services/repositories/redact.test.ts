import { describe, expect, it } from "vitest";
import { createSeedSnapshot } from "@/data/seed";
import { member, snapshot, visitor } from "@/tests/factories";
import type { ActivityEvent } from "@/types/activity";
import { withoutRestricted, withoutUnseenTaskActivity } from "./redact";

const careEntry: ActivityEvent = {
  id: "a_care",
  type: "care.created",
  category: "care",
  personId: "person_member",
  summary: "Pastoral-care record CARE-001 opened.",
  at: "2026-10-01T09:00:00.000Z",
  visibility: "restricted",
};
const generalEntry: ActivityEvent = { ...careEntry, id: "a_general", type: "membership.registered", category: "membership", summary: "Joined.", visibility: "general" };

function church() {
  const base = member();
  return snapshot({
    people: [
      { ...base, member: { ...base.member!, emergencyContact: { name: "David", relationship: "Spouse", phone: "+44 7700 900400" } } },
      visitor(),
    ],
    activity: [careEntry, generalEntry],
  });
}

describe("withoutRestricted", () => {
  it("removes emergency contacts and restricted timeline entries", () => {
    const redacted = withoutRestricted(church());
    expect(redacted.people[0].member?.emergencyContact).toBeUndefined();
    expect(redacted.people[0].member?.reference).toBeDefined();
    expect(redacted.activity.map((entry) => entry.id)).toEqual(["a_general"]);
  });

  it("leaves everyone and everything else as it was, without changing the original", () => {
    const original = church();
    const redacted = withoutRestricted(original);
    expect(redacted.people).toHaveLength(2);
    expect(redacted.people[1]).toBe(original.people[1]);
    expect(original.people[0].member?.emergencyContact?.name).toBe("David");
    expect(original.activity).toHaveLength(2);
  });
});

describe("withoutUnseenTaskActivity", () => {
  it("keeps history only for the follow-ups this caller can see", () => {
    const base = createSeedSnapshot(new Date("2026-10-12T09:00:00.000Z"));
    const [mine] = base.tasks;
    const scoped = { ...base, tasks: [mine] };
    const result = withoutUnseenTaskActivity(scoped);

    const taskIds = result.activity.map((entry) => entry.meta?.taskId).filter(Boolean);
    expect(taskIds.length).toBeGreaterThan(0);
    expect(new Set(taskIds)).toEqual(new Set([mine.id]));
    // Entries that aren't about a task are untouched.
    expect(result.activity.filter((entry) => !entry.meta?.taskId)).toHaveLength(
      base.activity.filter((entry) => !entry.meta?.taskId).length,
    );
  });
});

