import { describe, expect, it } from "vitest";
import {
  quickRegistrationSchema,
  selfRegistrationSchema,
  visitorRegistrationSchema,
  type VisitorRegistrationValues,
} from "./schema";

const valid: VisitorRegistrationValues = {
  firstName: "Tunde",
  lastName: "Balogun",
  visitDate: "2026-10-11",
  source: "walk_in",
  preferredMethod: "in_person",
  permissionGranted: false,
};

function messages(result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("visitorRegistrationSchema", () => {
  it("accepts a name and a visit date, applying defaults", () => {
    const parsed = visitorRegistrationSchema.parse({ ...valid, firstName: "  Tunde  " });
    expect(parsed.firstName).toBe("Tunde");
    expect(parsed.interests).toEqual([]);
    expect(parsed.returningVisitor).toBe(false);
  });

  it.each([
    [{ firstName: "   " }, "firstName: A first name is needed."],
    [{ lastName: "" }, "lastName: A last name is needed."],
    [{ visitDate: "11/10/2026" }, "visitDate: Choose the date of the visit."],
    [{ phone: "call me" }, "phone: Use digits, spaces and + ( ) - only."],
    [{ phone: "1".repeat(33) }, "phone: That phone number looks too long."],
    [{ email: "not-an-email" }, "email: That email address does not look right."],
    [{ notes: "x".repeat(501) }, "notes: Keep notes under 500 characters."],
  ])("rejects %j", (override, message) => {
    expect(messages(visitorRegistrationSchema.safeParse({ ...valid, ...override }))).toContain(message);
  });

  it.each([
    ["an empty phone and email", { phone: "", email: "" }],
    ["a formatted phone number", { phone: "+44 (0)7700-900111" }],
    ["a valid email", { email: "tunde@example.com" }],
  ])("accepts %s", (_label, override) => {
    expect(visitorRegistrationSchema.safeParse({ ...valid, ...override }).success).toBe(true);
  });

  it("requires a way to reach someone who gave permission to be contacted", () => {
    const result = visitorRegistrationSchema.safeParse({
      ...valid,
      permissionGranted: true,
      preferredMethod: "phone",
      phone: "   ",
    });
    expect(messages(result)).toEqual([
      "preferredMethod: Add a phone number or email, or choose 'in person' as the contact method.",
    ]);
  });

  it.each([
    ["in person", { preferredMethod: "in_person" as const }],
    ["a phone number", { preferredMethod: "phone" as const, phone: "07700 900111" }],
    ["an email", { preferredMethod: "email" as const, email: "a@b.co" }],
  ])("allows permission with %s", (_label, override) => {
    expect(
      visitorRegistrationSchema.safeParse({ ...valid, permissionGranted: true, ...override }).success,
    ).toBe(true);
  });

  it("rejects an unknown source", () => {
    expect(visitorRegistrationSchema.safeParse({ ...valid, source: "billboard" }).success).toBe(false);
  });
});

describe("selfRegistrationSchema", () => {
  it("defaults to a first visit", () => {
    const parsed = selfRegistrationSchema.parse({
      firstName: "Ada",
      lastName: "Okafor",
      preferredMethod: "email",
      permissionGranted: true,
    });
    expect(parsed.firstVisit).toBe(true);
  });

  it("speaks to the visitor in its messages", () => {
    const result = selfRegistrationSchema.safeParse({
      firstName: "",
      lastName: "",
      email: "nope",
      preferredMethod: "email",
      permissionGranted: true,
    });
    expect(messages(result)).toEqual([
      "firstName: Please tell us your first name.",
      "lastName: Please tell us your last name.",
      "email: That email address does not look right.",
    ]);
  });
});

describe("quickRegistrationSchema", () => {
  it("accepts the minimum record", () => {
    expect(
      quickRegistrationSchema.safeParse({
        firstName: "Ada",
        lastName: "Okafor",
        source: "online",
        preferredMethod: "sms",
        permissionGranted: false,
      }).success,
    ).toBe(true);
  });

  it("validates the phone number", () => {
    const result = quickRegistrationSchema.safeParse({
      firstName: "Ada",
      lastName: "Okafor",
      phone: "12",
      source: "online",
      preferredMethod: "sms",
      permissionGranted: false,
    });
    expect(messages(result)).toEqual(["phone: Use digits, spaces and + ( ) - only."]);
  });
});

describe("audit fixes: limits shared with the server", () => {
  const quick = {
    firstName: "Zed",
    lastName: "Quickone",
    source: "walk_in" as const,
    preferredMethod: "in_person" as const,
    permissionGranted: false,
  };

  it("refuses a name over 80 characters with a plain message", () => {
    const outcome = quickRegistrationSchema.safeParse({ ...quick, firstName: "x".repeat(81) });
    expect(outcome.success).toBe(false);
    if (!outcome.success) expect(outcome.error.issues[0].message).toBe("Keep the first name to 80 characters.");
    expect(quickRegistrationSchema.safeParse({ ...quick, firstName: "x".repeat(80) }).success).toBe(true);
  });

  it("explains an overlong preferred name", () => {
    const outcome = visitorRegistrationSchema.safeParse({
      ...quick,
      preferredName: "x".repeat(41),
      visitDate: "2026-10-11",
    });
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error.issues.find((issue) => issue.path[0] === "preferredName")?.message).toBe(
        "Keep the preferred name to 40 characters.",
      );
    }
  });
});
