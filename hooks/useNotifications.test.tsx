import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { freezeTime, resetHarness, seedChurch, toastMock, TODAY } from "@/tests/hooks-harness";
import { useNotifications } from "./useNotifications";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const OPEN = ["pending", "in_progress", "rescheduled"];
const HORIZON = "2026-10-26";

const raised: Array<{ title: string; options?: NotificationOptions }> = [];

function stubNotification(permission: NotificationPermission): void {
  class FakeNotification {
    static permission = permission;
    constructor(title: string, options?: NotificationOptions) {
      raised.push({ title, options });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
}

beforeEach(() => {
  raised.length = 0;
  freezeTime();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetHarness();
});

describe("useNotifications agenda", () => {
  it("lists open tasks due within two weeks and upcoming services, in date order", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useNotifications());

    const tasks = snapshot.tasks.filter((task) => OPEN.includes(task.status) && task.dueDate <= HORIZON);
    const sessions = snapshot.sessions.filter((session) => session.date >= TODAY && session.date <= HORIZON);

    expect(result.current.today).toBe(TODAY);
    expect(result.current.agenda.filter((entry) => entry.kind === "task")).toHaveLength(tasks.length);
    expect(result.current.agenda.filter((entry) => entry.kind === "service").map((entry) => entry.id)).toEqual(
      sessions.map((session) => session.id),
    );
    const dates = result.current.agenda.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("describes a task entry with its person, link and overdue flag", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useNotifications());

    const task = snapshot.tasks.find((entry) => entry.id === "task_35")!;
    const person = snapshot.people.find((entry) => entry.id === task.personId)!;
    const entry = result.current.agenda.find((item) => item.id === "task_35");

    expect(entry).toEqual({
      id: "task_35",
      date: "2026-10-08",
      kind: "task",
      title: `${task.reference} · ${task.type.replace(/_/g, " ")}`,
      detail: `${person.firstName} ${person.lastName}`,
      href: "/follow-ups/tasks?task=task_35",
      overdue: true,
    });
  });

  it("describes a service entry and says when a task's person is missing", () => {
    const snapshot = seedChurch();
    seedChurch({
      snapshot: {
        ...snapshot,
        people: snapshot.people.filter((person) => person.id !== snapshot.tasks.find((task) => task.id === "task_19")!.personId),
      },
    });
    const { result } = renderHook(() => useNotifications());

    expect(result.current.agenda.find((item) => item.id === "session_17")).toMatchObject({
      kind: "service",
      date: "2026-10-18",
      title: "Sunday service",
      href: "/attendance/session_17",
      overdue: false,
    });
    expect(result.current.agenda.find((item) => item.id === "task_19")?.detail).toBe("Unknown person");
  });

  it("collects the signed-in person's tasks due today and overdue", () => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useNotifications());

    expect(result.current.mine.dueToday.map((task) => task.id).sort()).toEqual(["task_19", "task_23"]);
    expect(result.current.mine.overdue.map((task) => task.id)).toEqual(["task_35"]);
  });
});

describe("useNotifications permission and reminders", () => {
  it("reports unsupported when the browser has no Notification API", () => {
    vi.stubGlobal("Notification", undefined);
    // `"Notification" in window` must be false, not merely undefined.
    delete (window as unknown as Record<string, unknown>).Notification;
    seedChurch();
    const { result } = renderHook(() => useNotifications());
    expect(result.current.permission).toBe("unsupported");
  });

  it("raises a browser notification when permission was granted", () => {
    stubNotification("granted");
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useNotifications());

    expect(result.current.permission).toBe("granted");
    result.current.notifyDueToday();

    expect(raised).toEqual([
      { title: "GatherFlow reminders", options: { body: "2 due today, 1 overdue." } },
    ]);
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it("falls back to a toast when permission was not granted", () => {
    stubNotification("default");
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useNotifications());

    expect(result.current.permission).toBe("default");
    result.current.notifyDueToday();

    expect(raised).toEqual([]);
    expect(toastMock.info).toHaveBeenCalledWith("2 due today, 1 overdue.");
  });

  it("says there is nothing due when the person has no open work", () => {
    stubNotification("granted");
    seedChurch({ role: "member", teamMemberId: TEAM_IDS.member });
    const { result } = renderHook(() => useNotifications());

    result.current.notifyDueToday();

    expect(raised).toEqual([]);
    expect(toastMock.info).toHaveBeenCalledWith("Nothing is due for you right now.");
  });
});
