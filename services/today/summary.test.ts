import { describe, expect, it } from "vitest";
import { greeting, workSentence } from "./summary";

describe("greeting", () => {
  it("follows the time of day and uses the first name", () => {
    expect(greeting("Amara Nwosu", new Date(2026, 9, 16, 8))).toBe("Good morning, Amara");
    expect(greeting("Amara Nwosu", new Date(2026, 9, 16, 14))).toBe("Good afternoon, Amara");
    expect(greeting("Amara Nwosu", new Date(2026, 9, 16, 19))).toBe("Good evening, Amara");
    expect(greeting(undefined, new Date(2026, 9, 16, 8))).toBe("Good morning");
  });
});

describe("what is waiting, in a sentence", () => {
  it("is encouraging when nothing is waiting", () => {
    expect(workSentence({ dueToday: 0, overdue: 0 })).toBe("Nothing is waiting for you today.");
  });

  it("counts people in words, today first", () => {
    expect(workSentence({ dueToday: 1, overdue: 0 })).toBe("One person to reach today.");
    expect(workSentence({ dueToday: 2, overdue: 0 })).toBe("Two people to reach today.");
    expect(workSentence({ dueToday: 2, overdue: 3 })).toBe("Two people to reach today, and three still waiting from earlier.");
    expect(workSentence({ dueToday: 0, overdue: 1 })).toBe("One person still waiting from earlier.");
    expect(workSentence({ dueToday: 14, overdue: 0 })).toBe("14 people to reach today.");
  });
});
