import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { snapshot, task } from "@/tests/factories";
import { composeReminder, reminderCounts } from "./digest";

const TODAY = "2026-10-12";

describe("reminder counts", () => {
  it("counts only the open tasks assigned to that team member", () => {
    const data = snapshot({
      tasks: [
        task({ id: "t1", dueDate: TODAY }),
        task({ id: "t2", dueDate: "2026-10-01" }),
        task({ id: "t3", dueDate: "2026-10-20" }),
        task({ id: "t4", dueDate: TODAY, status: "completed" }),
        task({ id: "t5", dueDate: TODAY, assigneeId: TEAM_IDS.coordinator }),
      ],
    });
    expect(reminderCounts(data, TEAM_IDS.volunteerAmara, TODAY)).toEqual({ dueToday: 1, overdue: 1 });
    expect(reminderCounts(data, TEAM_IDS.coordinator, TODAY)).toEqual({ dueToday: 1, overdue: 0 });
  });
});

describe("reminder message", () => {
  it("says nothing when nothing is due", () => {
    expect(composeReminder([{ churchName: "Grace", dueToday: 0, overdue: 0 }])).toBeNull();
    expect(composeReminder([])).toBeNull();
  });

  it("gives counts, never names, for one church", () => {
    expect(composeReminder([{ churchName: "Grace", dueToday: 2, overdue: 1 }])).toEqual({
      title: "GatherFlow reminders",
      body: "2 follow-ups due today, 1 overdue.",
      url: "/follow-ups/my-tasks",
    });
  });

  it("names each church with work when there are several", () => {
    const message = composeReminder([
      { churchName: "Grace", dueToday: 1, overdue: 0 },
      { churchName: "Hope", dueToday: 0, overdue: 3 },
      { churchName: "Quiet", dueToday: 0, overdue: 0 },
    ]);
    expect(message?.body).toBe("Grace: 1 follow-up due today. Hope: 3 overdue.");
  });
});
