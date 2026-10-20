import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, unwrap, type Result } from "./result";

describe("result", () => {
  it("builds ok and err values", () => {
    expect(ok(5)).toEqual({ ok: true, value: 5 });
    expect(err("No such person.", "not_found")).toEqual({ ok: false, error: "No such person.", code: "not_found" });
    expect(err("Refused.")).toEqual({ ok: false, error: "Refused.", code: undefined });
  });

  it("narrows with isOk and isErr", () => {
    const good: Result<number> = ok(1);
    const bad: Result<number> = err("x");
    expect([isOk(good), isErr(good)]).toEqual([true, false]);
    expect([isOk(bad), isErr(bad)]).toEqual([false, true]);
  });

  it("unwrap returns the value or throws the error message", () => {
    expect(unwrap(ok("value"))).toBe("value");
    expect(() => unwrap(err("Visitor opted out.", "opted_out"))).toThrow(new Error("Visitor opted out."));
  });
});
