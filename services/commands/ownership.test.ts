import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { snapshot, task, visitor } from "@/tests/factories";
import { looksAfter, ownsTask } from "./ownership";

const AMARA = TEAM_IDS.volunteerAmara;
const TUNDE = TEAM_IDS.volunteerTunde;

describe("ownership", () => {
  const data = snapshot({
    people: [
      visitor({ id: "person_mine", visitor: { ...visitor().visitor!, assignedTo: AMARA } }),
      visitor({ id: "person_theirs", visitor: { ...visitor().visitor!, assignedTo: TUNDE } }),
      visitor({ id: "person_task_only", visitor: { ...visitor().visitor!, assignedTo: TUNDE } }),
    ],
    tasks: [
      task({ id: "task_mine", personId: "person_task_only", assigneeId: AMARA }),
      task({ id: "task_theirs", personId: "person_theirs", assigneeId: TUNDE }),
    ],
  });

  it("owns only tasks assigned to them", () => {
    expect(ownsTask(data, "task_mine", AMARA)).toBe(true);
    expect(ownsTask(data, "task_theirs", AMARA)).toBe(false);
    expect(ownsTask(data, "task_missing", AMARA)).toBe(false);
  });

  it("looks after visitors assigned to them, or that they have been given work for", () => {
    expect(looksAfter(data, "person_mine", AMARA)).toBe(true);
    expect(looksAfter(data, "person_task_only", AMARA)).toBe(true);
    expect(looksAfter(data, "person_theirs", AMARA)).toBe(false);
    expect(looksAfter(data, "person_missing", AMARA)).toBe(false);
  });
});
