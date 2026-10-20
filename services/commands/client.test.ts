import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  changeAccountEmail,
  createInvitation,
  deleteAccount,
  fetchAudit,
  fetchChurch,
  fetchEmailStatus,
  fetchInvitations,
  fetchMembers,
  fetchPushStatus,
  newRequestId,
  postCommand,
  postEmail,
  postSignOut,
  removeMember,
  revokeInvitation,
  setMemberRole,
  subscribePush,
  unsubscribePush,
} from "./client";

/**
 * The client is a thin transport, so these tests pin exactly what goes over
 * the wire and how each kind of answer — envelope, refusal, junk, nothing —
 * comes back as a Result.
 */

const TRANSPORT_MESSAGE = "Could not reach the server. Your change has not been saved.";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return [call[0] as string, (call[1] ?? {}) as RequestInit];
}

describe("response parsing", () => {
  it("returns the data of a success envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { entries: [] } }));
    expect(await fetchAudit()).toEqual({ ok: true, value: { entries: [] } });
  });

  it("returns the server's refusal message and code", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "Not allowed.", code: "forbidden" }, 403));
    expect(await fetchAudit()).toEqual({ ok: false, error: "Not allowed.", code: "forbidden" });
  });

  it("treats an ok envelope without data as a generic refusal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    expect(await fetchAudit()).toEqual({ ok: false, error: "The server refused that request.", code: undefined });
  });

  it("treats a non-JSON body as a transport error carrying the status", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await fetchAudit()).toEqual({
      ok: false,
      error: "The server responded with 502 and no usable body.",
      code: "transport",
    });
  });

  it("treats an empty 500 as a transport error", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    expect(await fetchMembers()).toEqual({
      ok: false,
      error: "The server responded with 500 and no usable body.",
      code: "transport",
    });
  });

  it.each([
    ["fetchChurch", () => fetchChurch()],
    ["postCommand", () => postCommand("care.setAppointmentStatus", { recordId: "r1", appointmentId: "a1", status: "completed" })],
    ["postEmail", () => postEmail({} as never)],
    ["fetchEmailStatus", () => fetchEmailStatus()],
    ["fetchAudit", () => fetchAudit()],
    ["fetchMembers (via call)", () => fetchMembers()],
  ])("%s turns a network failure into a transport error", async (_name, run) => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await run()).toEqual({ ok: false, error: TRANSPORT_MESSAGE, code: "transport" });
  });

  it("says a cancelled request was cancelled", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    expect(await fetchChurch()).toEqual({ ok: false, error: "That request was cancelled.", code: "transport" });
  });

  it("does not mistake other DOMExceptions for cancellation", async () => {
    fetchMock.mockRejectedValue(new DOMException("nope", "NetworkError"));
    expect(await fetchChurch()).toEqual({ ok: false, error: TRANSPORT_MESSAGE, code: "transport" });
  });
});

describe("church reads", () => {
  it("fetchChurch GETs the church uncached and forwards the abort signal", async () => {
    const remote = { snapshot: { people: [] }, version: 4, seeded: false };
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: remote }));
    const controller = new AbortController();

    expect(await fetchChurch(controller.signal)).toEqual({ ok: true, value: remote });
    expect(lastCall()).toEqual([
      "/api/church",
      { method: "GET", headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" },
    ]);
  });

  it.each([
    ["fetchEmailStatus", fetchEmailStatus, "/api/church/email"],
    ["fetchAudit", fetchAudit, "/api/church/audit"],
  ] as const)("%s GETs %s uncached", async (_name, run, url) => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {} }));
    const controller = new AbortController();
    await run(controller.signal);
    expect(lastCall()).toEqual([
      url,
      { method: "GET", headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" },
    ]);
  });
});

describe("commands and email", () => {
  it("postCommand sends only the name, the input and the request id", async () => {
    const result = { snapshot: { people: [] }, notices: ["Saved."], data: { personId: "p1" } };
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: result }));

    const outcome = await postCommand(
      "care.setAppointmentStatus",
      { recordId: "r1", appointmentId: "a1", status: "completed" },
      "request-0001",
    );

    expect(outcome).toEqual({ ok: true, value: result });
    const [url, init] = lastCall();
    expect(url).toBe("/api/church/commands");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(JSON_HEADERS);
    expect(JSON.parse(init.body as string)).toEqual({
      name: "care.setAppointmentStatus",
      input: { recordId: "r1", appointmentId: "a1", status: "completed" },
      requestId: "request-0001",
    });
  });

  it("postCommand sends a lost request again under the same id, and stops at the first answer", async () => {
    const result = { snapshot: { people: [] }, notices: [], data: {} };
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: result }));

    const outcome = await postCommand("task.start", { taskId: "t1" });

    expect(outcome).toEqual({ ok: true, value: result });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).requestId);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it("postCommand gives up after three tries, and never retries a cancelled request", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await postCommand("task.start", { taskId: "t1" })).toMatchObject({ ok: false, code: "transport" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await postCommand("task.start", { taskId: "t1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives every intent its own id", () => {
    expect(newRequestId()).not.toBe(newRequestId());
    expect(newRequestId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("postEmail posts the request as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "Email is off.", code: "email_disabled" }, 409));
    const request = { personId: "p1", subject: "Hello", body: "Hi" };

    expect(await postEmail(request as never)).toEqual({ ok: false, error: "Email is off.", code: "email_disabled" });
    const [url, init] = lastCall();
    expect(url).toBe("/api/church/email");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(JSON_HEADERS);
    expect(JSON.parse(init.body as string)).toEqual(request);
  });
});

describe("account, member, invitation and push calls", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { done: true } }));
  });

  it.each<[string, () => Promise<unknown>, string, string | undefined, unknown]>([
    ["fetchMembers", () => fetchMembers(), "/api/church/members", undefined, undefined],
    [
      "setMemberRole",
      () => setMemberRole("u1", "pastor"),
      "/api/church/members",
      "PATCH",
      { userId: "u1", role: "pastor" },
    ],
    ["removeMember", () => removeMember("u 1&x"), "/api/church/members?userId=u%201%26x", "DELETE", undefined],
    ["fetchInvitations", () => fetchInvitations(), "/api/church/invitations", undefined, undefined],
    [
      "createInvitation",
      () => createInvitation({ email: "a@b.org", role: "volunteer", teamMemberId: "tm1" }),
      "/api/church/invitations",
      "POST",
      { email: "a@b.org", role: "volunteer", teamMemberId: "tm1" },
    ],
    ["revokeInvitation", () => revokeInvitation("inv/1"), "/api/church/invitations?id=inv%2F1", "DELETE", undefined],
    [
      "changeAccountEmail",
      () => changeAccountEmail({ newEmail: "n@b.org", password: "pw" }),
      "/api/account/email",
      "POST",
      { newEmail: "n@b.org", password: "pw" },
    ],
    ["deleteAccount", () => deleteAccount("secret"), "/api/account/delete", "POST", { password: "secret" }],
    ["fetchPushStatus without endpoint", () => fetchPushStatus(), "/api/push", undefined, undefined],
    [
      "fetchPushStatus with endpoint",
      () => fetchPushStatus("https://push.example/a?b=c"),
      "/api/push?endpoint=https%3A%2F%2Fpush.example%2Fa%3Fb%3Dc",
      undefined,
      undefined,
    ],
    [
      "subscribePush",
      () => subscribePush({ endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } }),
      "/api/push",
      "POST",
      { endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } },
    ],
    [
      "unsubscribePush",
      () => unsubscribePush("https://push.example/1"),
      "/api/push?endpoint=https%3A%2F%2Fpush.example%2F1",
      "DELETE",
      undefined,
    ],
  ])("%s requests %s", async (_name, run, url, method, body) => {
    expect(await run()).toEqual({ ok: true, value: { done: true } });
    const [calledUrl, init] = lastCall();
    expect(calledUrl).toBe(url);
    expect(init.method).toBe(method);
    expect(init.headers).toEqual(JSON_HEADERS);
    expect(init.cache).toBe("no-store");
    expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
  });
});

describe("postSignOut", () => {
  function stubServiceWorker(getRegistration: () => Promise<unknown>) {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(getRegistration) },
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {} }));
  });

  const signOutCalls = [
    ["/api/churches/select", { method: "DELETE" }],
    ["/api/auth/sign-out", { method: "POST", headers: { accept: "application/json" } }],
  ];

  it("clears the church choice then signs out when there is no service worker", async () => {
    expect("serviceWorker" in navigator).toBe(false);
    await postSignOut();
    expect(fetchMock.mock.calls).toEqual(signOutCalls);
  });

  it("forgets an existing push subscription first", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscription = { endpoint: "https://push.example/sub 1", unsubscribe };
    stubServiceWorker(async () => ({ pushManager: { getSubscription: async () => subscription } }));

    await postSignOut();

    expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledWith("/");
    expect(fetchMock.mock.calls).toEqual([
      ["/api/push?endpoint=https%3A%2F%2Fpush.example%2Fsub%201", { method: "DELETE" }],
      ...signOutCalls,
    ]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no registration", async () => undefined],
    ["no subscription", async () => ({ pushManager: { getSubscription: async () => null } })],
  ])("skips the push step with %s", async (_label, getRegistration) => {
    stubServiceWorker(getRegistration);
    await postSignOut();
    expect(fetchMock.mock.calls).toEqual(signOutCalls);
  });

  it("still signs out when reading push state throws", async () => {
    stubServiceWorker(async () => {
      throw new Error("SecurityError");
    });
    await postSignOut();
    expect(fetchMock.mock.calls).toEqual(signOutCalls);
  });

  it("resolves quietly when the network is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(postSignOut()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
