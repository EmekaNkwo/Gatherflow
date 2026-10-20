import { describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { FORM_ERROR_TOAST, showFormError } from "./form-toast";
import { notifyRateLimited } from "./rate-limit";

describe("showFormError", () => {
  it("joins the server's words and the hint as sentences", () => {
    showFormError("That didn’t work", "Invalid email or password", "Try again.");
    expect(toast.error).toHaveBeenLastCalledWith("That didn’t work", {
      id: FORM_ERROR_TOAST,
      description: "Invalid email or password. Try again.",
    });
  });

  it("does not double a full stop, and works without a hint", () => {
    showFormError("Not saved yet", "Please tell the welcome desk.");
    expect(toast.error).toHaveBeenLastCalledWith("Not saved yet", {
      id: FORM_ERROR_TOAST,
      description: "Please tell the welcome desk.",
    });
  });

  it("replaces the previous form error instead of stacking another", () => {
    showFormError("A", "one");
    showFormError("A", "two");
    const ids = toast.error.mock.calls.slice(-2).map(([, options]) => options.id);
    expect(ids).toEqual([FORM_ERROR_TOAST, FORM_ERROR_TOAST]);
  });
});

describe("notifyRateLimited", () => {
  it("clears the form error, so the wait is what the person sees", () => {
    notifyRateLimited(9);
    expect(toast.dismiss).toHaveBeenCalledWith(FORM_ERROR_TOAST);
  });
});
