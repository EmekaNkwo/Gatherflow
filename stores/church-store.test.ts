import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import { fetchChurch, postCommand, postEmail, type RemoteSnapshot } from "@/services/commands/client";
import { EMAIL_UNAVAILABLE } from "@/types/email";
import type { ChurchSnapshot } from "@/types/snapshot";
import { currentSnapshot, notReady, setSessionAdopter, useChurchStore } from "./church-store";

vi.mock("@/services/commands/client", () => ({
  newRequestId: vi.fn(() => `request-${Math.random().toString(36).slice(2, 12)}`),
  fetchChurch: vi.fn(),
  postCommand: vi.fn(),
  postEmail: vi.fn(),
}));

const fetchChurchMock = vi.mocked(fetchChurch);
const postCommandMock = vi.mocked(postCommand);
const postEmailMock = vi.mocked(postEmail);

const initialState = useChurchStore.getState();

const snapshotA = { people: [{ id: "p1" }] } as unknown as ChurchSnapshot;
const snapshotB = { people: [{ id: "p1" }, { id: "p2" }] } as unknown as ChurchSnapshot;
const emailOn = { configured: true, enabled: true, pilot: false, reason: null } as never;

function remote(overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return {
    snapshot: snapshotA,
    version: 7,
    seeded: true,
    report: { dropped: 1, issues: ["One task was malformed."] },
    email: emailOn,
    memberships: 3,
    actingAs: { role: "pastor", teamMemberId: "tm1" },
    churchId: "church_1",
    ...overrides,
  };
}

const adopter = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useChurchStore.setState(initialState, true);
  setSessionAdopter(adopter);
});

describe("initial state", () => {
  it("starts idle with nothing loaded", () => {
    const state = useChurchStore.getState();
    expect(state).toMatchObject({
      snapshot: null,
      status: "idle",
      seeded: false,
      report: null,
      lastNotices: [],
      loadError: null,
      loadErrorCode: null,
      remoteVersion: null,
      churchId: null,
      email: EMAIL_UNAVAILABLE,
      memberships: 1,
      actingAs: null,
    });
    expect(currentSnapshot()).toBeNull();
  });
});

describe("hydrate and refresh", () => {
  it("loads the church and records everything the server said", async () => {
    fetchChurchMock.mockResolvedValue(ok(remote()));

    await useChurchStore.getState().hydrate();

    expect(useChurchStore.getState()).toMatchObject({
      status: "ready",
      snapshot: snapshotA,
      seeded: true,
      report: { dropped: 1, issues: ["One task was malformed."] },
      remoteVersion: 7,
      churchId: "church_1",
      email: emailOn,
      memberships: 3,
      actingAs: { role: "pastor", teamMemberId: "tm1" },
      loadError: null,
      loadErrorCode: null,
    });
    expect(currentSnapshot()).toBe(snapshotA);
    expect(adopter).toHaveBeenCalledWith("pastor", "tm1");
  });

  it("adopts the session role before the church is marked ready", async () => {
    let statusWhenAdopted: string | undefined;
    setSessionAdopter(() => {
      statusWhenAdopted = useChurchStore.getState().status;
    });
    fetchChurchMock.mockResolvedValue(ok(remote()));

    await useChurchStore.getState().hydrate();

    expect(statusWhenAdopted).toBe("loading");
  });

  it("falls back to defaults for optional fields the server left out", async () => {
    fetchChurchMock.mockResolvedValue(
      ok(remote({ churchId: undefined, memberships: undefined, actingAs: undefined, email: undefined as never })),
    );

    await useChurchStore.getState().hydrate();

    expect(useChurchStore.getState()).toMatchObject({
      status: "ready",
      churchId: null,
      memberships: 1,
      actingAs: null,
      email: EMAIL_UNAVAILABLE,
    });
    expect(adopter).not.toHaveBeenCalled();
  });

  it("is marked loading while the request is in flight", async () => {
    let resolve: (value: Awaited<ReturnType<typeof fetchChurch>>) => void = () => undefined;
    fetchChurchMock.mockReturnValue(new Promise((r) => (resolve = r)));

    const pending = useChurchStore.getState().hydrate();
    expect(useChurchStore.getState().status).toBe("loading");

    // A second hydrate while loading does not start another request.
    await useChurchStore.getState().hydrate();
    expect(fetchChurchMock).toHaveBeenCalledTimes(1);

    resolve(ok(remote()));
    await pending;
    expect(useChurchStore.getState().status).toBe("ready");
  });

  it("does not reload once ready, but refresh does", async () => {
    fetchChurchMock.mockResolvedValue(ok(remote()));
    await useChurchStore.getState().hydrate();
    await useChurchStore.getState().hydrate();
    expect(fetchChurchMock).toHaveBeenCalledTimes(1);

    fetchChurchMock.mockResolvedValue(ok(remote({ snapshot: snapshotB, version: 8 })));
    await useChurchStore.getState().refresh();

    expect(fetchChurchMock).toHaveBeenCalledTimes(2);
    expect(useChurchStore.getState()).toMatchObject({ snapshot: snapshotB, remoteVersion: 8, status: "ready" });
  });

  it("marks the church unavailable and drops any snapshot on failure", async () => {
    useChurchStore.setState({ snapshot: snapshotA, status: "ready" });
    fetchChurchMock.mockResolvedValue(err("Please sign in.", "unauthenticated"));

    await useChurchStore.getState().refresh();

    expect(useChurchStore.getState()).toMatchObject({
      status: "unavailable",
      loadError: "Please sign in.",
      loadErrorCode: "unauthenticated",
      snapshot: null,
    });
  });

  it("records a null code when the refusal has none, and clears it on the next success", async () => {
    fetchChurchMock.mockResolvedValue(err("Something went wrong."));
    await useChurchStore.getState().hydrate();
    expect(useChurchStore.getState()).toMatchObject({ loadError: "Something went wrong.", loadErrorCode: null });

    // "unavailable" is not ready/loading, so hydrate retries.
    fetchChurchMock.mockResolvedValue(ok(remote()));
    await useChurchStore.getState().hydrate();
    expect(useChurchStore.getState()).toMatchObject({ status: "ready", loadError: null, loadErrorCode: null });
  });
});

describe("dispatch", () => {
  const input = { recordId: "r1", appointmentId: "a1", status: "completed" as const };

  it("posts the command by name and applies the server's snapshot and notices", async () => {
    postCommandMock.mockResolvedValue(
      ok({ snapshot: snapshotB, notices: ["Appointment completed."], data: { appointmentId: "a1" } }),
    );

    const result = await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);

    expect(postCommandMock).toHaveBeenCalledWith("care.setAppointmentStatus", input, expect.any(String));
    expect(result).toEqual({
      ok: true,
      value: { snapshot: snapshotB, events: [], notices: ["Appointment completed."], appointmentId: "a1" },
    });
    expect(useChurchStore.getState()).toMatchObject({
      snapshot: snapshotB,
      lastNotices: ["Appointment completed."],
    });
  });

  it("returns a refusal unchanged and leaves state alone", async () => {
    useChurchStore.setState({ snapshot: snapshotA, lastNotices: ["Earlier."] });
    postCommandMock.mockResolvedValue(err("You cannot do that.", "forbidden"));

    const result = await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);

    expect(result).toEqual({ ok: false, error: "You cannot do that.", code: "forbidden" });
    expect(useChurchStore.getState()).toMatchObject({ snapshot: snapshotA, lastNotices: ["Earlier."] });
  });
});

describe("double submits and stale screens", () => {
  const input = { recordId: "r1", appointmentId: "a1", status: "completed" as const };

  it("sends an identical command once while the first is still in flight", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postCommandMock.mockReturnValue(new Promise((done) => (resolve = done)) as never);

    const first = useChurchStore.getState().dispatch("care.setAppointmentStatus", input);
    const second = useChurchStore.getState().dispatch("care.setAppointmentStatus", input);
    resolve(ok({ snapshot: snapshotB, notices: [], data: {} }));

    expect(await first).toEqual(await second);
    expect(postCommandMock).toHaveBeenCalledTimes(1);

    // Once it has finished, the same command may be sent again on purpose.
    postCommandMock.mockResolvedValue(ok({ snapshot: snapshotB, notices: [], data: {} }));
    await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);
    expect(postCommandMock).toHaveBeenCalledTimes(2);
  });

  it("tries again under the same request id when the first attempt got no answer", async () => {
    postCommandMock.mockResolvedValueOnce(err("Could not reach the server.", "transport"));
    await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);

    postCommandMock.mockResolvedValue(ok({ snapshot: snapshotB, notices: [], data: {} }));
    await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);
    // And once answered, the next attempt is a new intent with a new id.
    await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);

    const ids = postCommandMock.mock.calls.map((call) => call[2]);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it("sends different commands side by side", async () => {
    postCommandMock.mockResolvedValue(ok({ snapshot: snapshotB, notices: [], data: {} }));
    await Promise.all([
      useChurchStore.getState().dispatch("care.setAppointmentStatus", input),
      useChurchStore.getState().dispatch("care.setAppointmentStatus", { ...input, appointmentId: "a2" }),
    ]);
    expect(postCommandMock).toHaveBeenCalledTimes(2);
  });

  it("re-reads the church quietly after a refusal that means the screen was out of date", async () => {
    useChurchStore.setState({ snapshot: snapshotA, status: "ready" });
    postCommandMock.mockResolvedValue(err("That task has already been closed.", "closed"));
    fetchChurchMock.mockResolvedValue(ok(remote({ snapshot: snapshotB })));

    await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);
    await vi.waitFor(() => expect(useChurchStore.getState().snapshot).toBe(snapshotB));
    expect(useChurchStore.getState().status).toBe("ready");
  });

  it("does not re-read after a refusal about the request itself", async () => {
    useChurchStore.setState({ snapshot: snapshotA, status: "ready" });
    postCommandMock.mockResolvedValue(err("You cannot do that.", "forbidden"));
    await useChurchStore.getState().dispatch("care.setAppointmentStatus", input);
    expect(fetchChurchMock).not.toHaveBeenCalled();
  });

  it("keeps what is on screen when a quiet re-read fails, and skips it before the first load", async () => {
    useChurchStore.setState({ snapshot: snapshotA, status: "ready" });
    fetchChurchMock.mockResolvedValue(err("Offline.", "transport"));
    await useChurchStore.getState().revalidate();
    expect(useChurchStore.getState()).toMatchObject({ snapshot: snapshotA, status: "ready" });

    useChurchStore.setState({ status: "idle" });
    fetchChurchMock.mockClear();
    await useChurchStore.getState().revalidate();
    expect(fetchChurchMock).not.toHaveBeenCalled();
  });
});

describe("sendEmail", () => {
  const request = { personId: "p1", subject: "Welcome", body: "Hi" } as never;

  it("applies the snapshot and returns the receipt", async () => {
    const receipt = { outboxId: "o1", status: "queued" };
    postEmailMock.mockResolvedValue(ok({ snapshot: snapshotB, notices: ["Email queued."], data: receipt as never }));

    const result = await useChurchStore.getState().sendEmail(request);

    expect(postEmailMock).toHaveBeenCalledWith(request);
    expect(result).toEqual({ ok: true, value: receipt });
    expect(useChurchStore.getState()).toMatchObject({ snapshot: snapshotB, lastNotices: ["Email queued."] });
  });

  it("returns a refusal and leaves state alone", async () => {
    useChurchStore.setState({ snapshot: snapshotA });
    postEmailMock.mockResolvedValue(err("Opted out.", "opted_out"));

    expect(await useChurchStore.getState().sendEmail(request)).toEqual({
      ok: false,
      error: "Opted out.",
      code: "opted_out",
    });
    expect(useChurchStore.getState().snapshot).toBe(snapshotA);
    expect(useChurchStore.getState().lastNotices).toEqual([]);
  });
});

describe("notReady", () => {
  it("is a not_ready refusal", () => {
    expect(notReady()).toEqual({ ok: false, error: "The church data is still loading.", code: "not_ready" });
  });
});
