import { Component, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChurchStore } from "@/stores/church-store";
import {
  acceptCommands,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  toastMock,
} from "@/tests/hooks-harness";
import { useCommand, useIsReady, useSnapshot } from "./use-church-data";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

afterEach(resetHarness);

describe("useSnapshot", () => {
  it("throws a clear error when the church has not been loaded", () => {
    const caught: Error[] = [];
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: Error) {
        caught.push(error);
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      renderHook(() => useSnapshot(), { wrapper: Boundary });
    } finally {
      quiet.mockRestore();
    }
    expect(caught.map((error) => error.message)).toEqual([
      "Church data has not been loaded. Render this inside <ChurchDataProvider>.",
    ]);
  });

  it("returns the loaded snapshot", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useSnapshot());
    expect(result.current).toBe(snapshot);
    expect(result.current.settings.churchName).toBe(snapshot.settings.churchName);
  });
});

describe("useIsReady", () => {
  it("is false before loading and true once the snapshot is ready", () => {
    const { result, rerender } = renderHook(() => useIsReady());
    expect(result.current).toBe(false);

    act(() => {
      seedChurch();
    });
    rerender();
    expect(result.current).toBe(true);
  });

  it("is false while a reload is in flight even with a snapshot", () => {
    seedChurch();
    useChurchStore.setState({ status: "loading" });
    const { result } = renderHook(() => useIsReady());
    expect(result.current).toBe(false);
  });
});

describe("useCommand", () => {
  beforeEach(() => {
    seedChurch();
  });

  it("sends the command by name and input and adopts the server's snapshot", async () => {
    acceptCommands({
      notices: ["Saved."],
      data: { id: "task_new" },
      change: (snapshot) => ({ ...snapshot, settings: { ...snapshot.settings, churchName: "New Name" } }),
    });
    const { result } = renderHook(() => useCommand());

    let outcome: Awaited<ReturnType<typeof result.current.dispatch>> | undefined;
    await act(async () => {
      outcome = await result.current.dispatch("task.start", { taskId: "task_1" });
    });

    expect(lastCommand()).toEqual({ name: "task.start", input: { taskId: "task_1" } });
    expect(outcome?.ok).toBe(true);
    expect(outcome?.ok && (outcome.value as unknown as { id: string }).id).toBe("task_new");
    expect(useChurchStore.getState().snapshot?.settings.churchName).toBe("New Name");
    expect(useChurchStore.getState().lastNotices).toEqual(["Saved."]);
    expect(toastMock.success).toHaveBeenCalledWith("Saved.", { description: undefined });
  });

  it("joins further notices into the toast description", async () => {
    acceptCommands({ notices: ["Task created.", "Assigned to Grace.", "Due Friday."] });
    const { result } = renderHook(() => useCommand());

    await act(async () => {
      await result.current.dispatch("task.start", { taskId: "task_1" });
    });

    expect(toastMock.success).toHaveBeenCalledWith("Task created.", {
      description: "Assigned to Grace. Due Friday.",
    });
  });

  it("leads with the caller's success message ahead of the server notices", async () => {
    acceptCommands({ notices: ["Assigned to Grace."] });
    const { result } = renderHook(() => useCommand());

    await act(async () => {
      await result.current.dispatch("task.start", { taskId: "t" }, { successMessage: "Started." });
    });

    expect(toastMock.success).toHaveBeenCalledWith("Started.", { description: "Assigned to Grace." });
  });

  it("shows no toast when silent or when there is nothing to say", async () => {
    acceptCommands({ notices: ["Saved."] });
    const { result } = renderHook(() => useCommand());

    await act(async () => {
      await result.current.dispatch("task.start", { taskId: "t" }, { silent: true });
    });
    acceptCommands({ notices: [] });
    await act(async () => {
      await result.current.dispatch("task.start", { taskId: "t" });
    });

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("surfaces a refusal as an error toast and leaves the snapshot alone", async () => {
    const before = useChurchStore.getState().snapshot;
    refuseCommands("You cannot do that.", "forbidden");
    const { result } = renderHook(() => useCommand());

    let outcome: Awaited<ReturnType<typeof result.current.dispatch>> | undefined;
    await act(async () => {
      outcome = await result.current.dispatch("task.start", { taskId: "t" });
    });

    expect(outcome).toEqual({ ok: false, error: "You cannot do that.", code: "forbidden" });
    expect(toastMock.error).toHaveBeenCalledWith("You cannot do that.");
    expect(useChurchStore.getState().snapshot).toBe(before);
  });
});
