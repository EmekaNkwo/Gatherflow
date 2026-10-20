import { beforeEach, describe, expect, it } from "vitest";
import { useWelcomeStore } from "./welcome-store";

describe("welcome store", () => {
  beforeEach(() => useWelcomeStore.getState().hide());

  it("opens without a service, and closes", () => {
    useWelcomeStore.getState().show();
    expect(useWelcomeStore.getState()).toMatchObject({ open: true, sessionId: undefined });
    useWelcomeStore.getState().hide();
    expect(useWelcomeStore.getState().open).toBe(false);
  });

  it("remembers the service it was opened for", () => {
    useWelcomeStore.getState().show({ sessionId: "session_sunday" });
    expect(useWelcomeStore.getState()).toMatchObject({ open: true, sessionId: "session_sunday" });
  });

  it("opens in the quick welcome unless asked for the full form", () => {
    useWelcomeStore.getState().show();
    expect(useWelcomeStore.getState().mode).toBe("quick");
    useWelcomeStore.getState().show({ mode: "full" });
    expect(useWelcomeStore.getState().mode).toBe("full");
  });

  it("switches between the two forms while open", () => {
    useWelcomeStore.getState().show({ sessionId: "session_sunday" });
    useWelcomeStore.getState().setMode("full");
    expect(useWelcomeStore.getState()).toMatchObject({ open: true, mode: "full", sessionId: "session_sunday" });
    useWelcomeStore.getState().setMode("quick");
    expect(useWelcomeStore.getState().mode).toBe("quick");
  });

  it("starts afresh every time it opens", () => {
    useWelcomeStore.getState().show({ sessionId: "session_sunday" });
    const first = useWelcomeStore.getState().opening;
    useWelcomeStore.getState().hide();
    useWelcomeStore.getState().show();
    expect(useWelcomeStore.getState().opening).toBeGreaterThan(first);
    expect(useWelcomeStore.getState().sessionId).toBeUndefined();
  });
});
