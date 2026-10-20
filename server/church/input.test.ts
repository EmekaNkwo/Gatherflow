import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FOLLOW_UP_TASK_TYPES } from "@/types/follow-up";
import { INVALID_INPUT, parseCommandInput } from "./input";

/**
 * A command input as it would arrive from a client, rather than from a form in
 * the same program.
 */
const createTaskInput = z.object({
  personId: z.string().min(1),
  type: z.enum(FOLLOW_UP_TASK_TYPES as unknown as [string, ...string[]]),
  notes: z.string().max(500).optional(),
});

describe("command input validation", () => {
  it("accepts a well-formed body", () => {
    const parsed = parseCommandInput(createTaskInput, {
      personId: "person-1",
      type: "welcome_message",
    });
    expect(parsed.ok).toBe(true);
  });

  it("refuses an unknown enum value rather than letting it reach the command", () => {
    // Before this guard, an unknown task type reached a label lookup inside
    // createFollowUpTask and threw, turning a bad request into a crash.
    const parsed = parseCommandInput(createTaskInput, {
      personId: "person-1",
      type: "welcome_call",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe(INVALID_INPUT);
      expect(parsed.error).toBe("Type isn't one of the choices on offer.");
    }
  });

  it("refuses a missing required field and says which", () => {
    const parsed = parseCommandInput(createTaskInput, { type: "welcome_message" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toBe("Person id is needed.");
  });

  it("refuses a body that is not an object at all", () => {
    for (const raw of [null, undefined, "welcome_message", 42, []]) {
      expect(parseCommandInput(createTaskInput, raw).ok).toBe(false);
    }
  });

  it("words a length limit in plain language, never the library's own text", () => {
    const parsed = parseCommandInput(createTaskInput, {
      personId: "person-1",
      type: "welcome_message",
      notes: "x".repeat(501),
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toBe("Notes is too long (500 characters at most).");
      expect(parsed.error).not.toMatch(/expected|<=|string/);
    }
  });

  it("words a number range and our own refinements in plain language", () => {
    const schema = z.object({
      dueInDays: z.number().int().min(0).max(60),
      date: z.string().refine(() => false, "must be a real date"),
    });
    const tooBig = parseCommandInput(schema, { dueInDays: 100, date: "x" });
    if (!tooBig.ok) expect(tooBig.error).toBe("Due in days must be 60 or less.");
    const badDate = parseCommandInput(schema, { dueInDays: 1, date: "2026-02-31" });
    if (!badDate.ok) expect(badDate.error).toBe("Date must be a real date.");
  });
});
