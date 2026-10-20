// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientAddress } from "./client-address";
import { respondRateLimited } from "./respond";

function request(headers: Record<string, string>) {
  return new Request("http://localhost/api/x", { headers });
}

describe("clientAddress", () => {
  it("takes the first address a proxy forwarded", () => {
    expect(clientAddress(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared 'unknown' bucket", () => {
    expect(clientAddress(request({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(request({}))).toBe("unknown");
    expect(clientAddress(request({ "x-forwarded-for": "  " }))).toBe("unknown");
  });
});

describe("respondRateLimited", () => {
  it("is a 429 that says how long to wait, in the header and the body", async () => {
    const response = respondRateLimited(42, "Too many tries.");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual({
      ok: false,
      error: "Too many tries.",
      code: "rate_limited",
      retryAfter: 42,
    });
  });

  it("never asks anyone to wait less than a second", () => {
    expect(respondRateLimited(0, "x").headers.get("Retry-After")).toBe("1");
  });
});
