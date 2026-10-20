import { describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, dismiss: vi.fn() } }));

import { notifyRateLimited, rateLimitedMessage, retryAfterCapture, retryAfterSeconds, tryAgainIn } from "./rate-limit";

describe("retryAfterSeconds", () => {
  it.each([
    [{ "Retry-After": "42" }, 42],
    [{ "X-Retry-After": "7" }, 7],
    [{ "Retry-After": "2.2" }, 3],
  ])("reads %o as %i seconds", (headers, seconds) => {
    expect(retryAfterSeconds(new Headers(headers))).toBe(seconds);
  });

  it("falls back when the header is missing or nonsense", () => {
    expect(retryAfterSeconds(new Headers())).toBe(30);
    expect(retryAfterSeconds(new Headers({ "Retry-After": "soon" }), 10)).toBe(10);
    expect(retryAfterSeconds(undefined, 5)).toBe(5);
  });
});

describe("rateLimitedMessage", () => {
  it.each([
    [1, "For your security, please wait a second and try again."],
    [42, "For your security, please wait 42 seconds and try again."],
    [90, "For your security, please wait about 2 minutes and try again."],
    [600, "For your security, please wait about 10 minutes and try again."],
  ])("says %i seconds in words", (seconds, message) => {
    expect(rateLimitedMessage(seconds)).toBe(message);
  });
});

describe("tryAgainIn", () => {
  it.each([
    [9, "Try again in 9s"],
    [89, "Try again in 89s"],
    [90, "Try again in 2 min"],
    [599, "Try again in 10 min"],
  ])("labels %i seconds as %s", (seconds, label) => {
    expect(tryAgainIn(seconds)).toBe(label);
  });
});

describe("notifyRateLimited", () => {
  it("shows one toast, replacing any earlier one", () => {
    notifyRateLimited(42);
    expect(toastError).toHaveBeenCalledWith("Too many attempts", {
      id: "rate-limited",
      description: "For your security, please wait 42 seconds and try again.",
    });
  });
});

describe("retryAfterCapture", () => {
  it("remembers the wait from a 429 response, and ignores other errors", () => {
    const capture = retryAfterCapture();
    capture.fetchOptions.onError({ response: new Response(null, { status: 401 }) });
    expect(capture.seconds()).toBeUndefined();
    capture.fetchOptions.onError({ response: new Response(null, { status: 429, headers: { "X-Retry-After": "9" } }) });
    expect(capture.seconds()).toBe(9);
  });
});
