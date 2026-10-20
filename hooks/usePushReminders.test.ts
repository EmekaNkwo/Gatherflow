import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import { invoke, resetHarness, toastMock, transport } from "@/tests/hooks-harness";
import { usePushReminders } from "./usePushReminders";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

/** "AQIDBA" is base64url for the bytes 1, 2, 3, 4 (and needs padding). */
const PUBLIC_KEY = "AQIDBA";
const ENDPOINT = "https://push.example.com/sub/abc";

function fakeSubscription(endpoint = ENDPOINT) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

type FakeSubscription = ReturnType<typeof fakeSubscription>;

interface Browser {
  existing: FakeSubscription | null;
  created: FakeSubscription;
  getSubscription: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
}

let browser: Browser;

/** Installs a push-capable browser with the given notification permission. */
function installBrowser(permission: NotificationPermission, existing: FakeSubscription | null = null): Browser {
  const created = fakeSubscription("https://push.example.com/sub/new");
  const getSubscription = vi.fn(async () => browser.existing);
  const subscribe = vi.fn(async () => created);
  const registration = { pushManager: { getSubscription, subscribe } };
  const register = vi.fn(async () => registration);
  const requestPermission = vi.fn(async (): Promise<NotificationPermission> => "granted");

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => registration),
      register,
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission, requestPermission });

  browser = { existing, created, getSubscription, subscribe, register, requestPermission };
  return browser;
}

function serverSays(available: boolean, subscribed: boolean, publicKey: string | null = PUBLIC_KEY): void {
  transport.fetchPushStatus.mockResolvedValue(ok({ available, publicKey, subscribed }));
}

async function settled() {
  const rendered = renderHook(() => usePushReminders());
  await waitFor(() => expect(rendered.result.current.state.status).not.toBe("loading"));
  return rendered;
}

beforeEach(() => {
  transport.subscribePush.mockResolvedValue(ok({ subscribed: true }));
  transport.unsubscribePush.mockResolvedValue(ok({ subscribed: false }));
});

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  vi.unstubAllGlobals();
  resetHarness();
});

describe("usePushReminders state", () => {
  it("starts out loading", () => {
    installBrowser("default");
    serverSays(true, false);
    const { result } = renderHook(() => usePushReminders());
    expect(result.current.state).toEqual({ status: "loading" });
    expect(result.current.busy).toBe(false);
  });

  it("is unavailable in a browser without push support", async () => {
    const { result } = await settled();

    expect(result.current.state).toEqual({
      status: "unavailable",
      reason: "This browser cannot receive reminders.",
    });
    expect(transport.fetchPushStatus).not.toHaveBeenCalled();
  });

  it("is unavailable when the server cannot be asked", async () => {
    installBrowser("default");
    transport.fetchPushStatus.mockResolvedValue(err("Could not reach the server.", "transport"));
    const { result } = await settled();

    expect(result.current.state).toEqual({ status: "unavailable", reason: "Could not reach the server." });
  });

  it.each([
    ["push is not configured", false, PUBLIC_KEY],
    ["there is no public key", true, null],
  ])("is unavailable when %s", async (_label, available, publicKey) => {
    installBrowser("default");
    serverSays(available, false, publicKey);
    const { result } = await settled();

    expect(result.current.state).toEqual({
      status: "unavailable",
      reason: "Reminders are not set up on this deployment yet.",
    });
  });

  it("is blocked when the person denied notifications", async () => {
    installBrowser("denied");
    serverSays(true, false);
    const { result } = await settled();

    expect(result.current.state).toEqual({ status: "blocked" });
  });

  it("is off when this browser is not subscribed", async () => {
    installBrowser("default");
    serverSays(true, false);
    const { result } = await settled();

    expect(result.current.state).toEqual({ status: "off", publicKey: PUBLIC_KEY });
    expect(transport.fetchPushStatus).toHaveBeenCalledWith(undefined);
  });

  it("is on when the server knows this browser's subscription", async () => {
    installBrowser("granted", fakeSubscription());
    serverSays(true, true);
    const { result } = await settled();

    expect(result.current.state).toEqual({ status: "on", publicKey: PUBLIC_KEY });
    expect(transport.fetchPushStatus).toHaveBeenCalledWith(ENDPOINT);
  });
});

describe("usePushReminders.enable", () => {
  it("subscribes with the server's key and turns reminders on", async () => {
    installBrowser("default");
    serverSays(true, false);
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    const options = browser.subscribe.mock.calls[0][0] as PushSubscriptionOptionsInit;
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(transport.subscribePush).toHaveBeenCalledWith(browser.created.toJSON());
    expect(result.current.state).toEqual({ status: "on", publicKey: PUBLIC_KEY });
    expect(result.current.busy).toBe(false);
    expect(toastMock.success).toHaveBeenCalledWith("Daily reminders are on for this browser.");
  });

  it("reuses a subscription the browser already holds", async () => {
    const existing = fakeSubscription();
    installBrowser("default", existing);
    serverSays(true, false);
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(transport.subscribePush).toHaveBeenCalledWith(existing.toJSON());
    expect(result.current.state.status).toBe("on");
  });

  it("becomes blocked when the person denies permission", async () => {
    installBrowser("default");
    serverSays(true, false);
    browser.requestPermission.mockResolvedValue("denied");
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(result.current.state).toEqual({ status: "blocked" });
    expect(browser.register).not.toHaveBeenCalled();
    expect(toastMock.info).toHaveBeenCalledWith("Reminders stay in the dashboard — nothing will pop up.");
    expect(result.current.busy).toBe(false);
  });

  it("stays off when the person dismisses the permission prompt", async () => {
    installBrowser("default");
    serverSays(true, false);
    browser.requestPermission.mockResolvedValue("default");
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(result.current.state).toEqual({ status: "off", publicKey: PUBLIC_KEY });
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });

  it("stays off and shows the error when the server refuses the subscription", async () => {
    installBrowser("default");
    serverSays(true, false);
    transport.subscribePush.mockResolvedValue(err("Push is disabled.", "push_disabled"));
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(result.current.state).toEqual({ status: "off", publicKey: PUBLIC_KEY });
    expect(toastMock.error).toHaveBeenCalledWith("Push is disabled.");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("shows the browser's error when subscribing throws", async () => {
    installBrowser("default");
    serverSays(true, false);
    browser.subscribe.mockRejectedValue(new Error("Registration failed - push service error"));
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(toastMock.error).toHaveBeenCalledWith("Registration failed - push service error");
    expect(result.current.state.status).toBe("off");
    expect(result.current.busy).toBe(false);
  });

  it("shows a generic message when something other than an Error is thrown", async () => {
    installBrowser("default");
    serverSays(true, false);
    browser.register.mockRejectedValue("nope");
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(toastMock.error).toHaveBeenCalledWith("Reminders could not be turned on.");
  });

  it("does nothing unless reminders are currently off", async () => {
    installBrowser("granted", fakeSubscription());
    serverSays(true, true);
    const { result } = await settled();

    await invoke(() => result.current.enable());

    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(transport.subscribePush).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("on");
  });
});

describe("usePushReminders.disable", () => {
  it("removes the subscription on the server and in the browser", async () => {
    const existing = fakeSubscription();
    installBrowser("granted", existing);
    serverSays(true, true);
    const { result } = await settled();

    await invoke(() => result.current.disable());

    expect(transport.unsubscribePush).toHaveBeenCalledWith(ENDPOINT);
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: "off", publicKey: PUBLIC_KEY });
    expect(result.current.busy).toBe(false);
    expect(toastMock.success).toHaveBeenCalledWith("Daily reminders are off for this browser.");
  });

  it("turns off cleanly when the browser no longer holds a subscription", async () => {
    installBrowser("granted", fakeSubscription());
    serverSays(true, true);
    const { result } = await settled();
    browser.existing = null;

    await invoke(() => result.current.disable());

    expect(transport.unsubscribePush).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "off", publicKey: PUBLIC_KEY });
  });

  it("stays on and says why when the server will not forget the browser", async () => {
    const existing = fakeSubscription();
    installBrowser("granted", existing);
    serverSays(true, true);
    transport.unsubscribePush.mockResolvedValue(err("You are not signed in.", "unauthenticated"));
    const { result } = await settled();

    await invoke(() => result.current.disable());

    // The browser keeps its subscription, so the two sides still agree.
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("on");
    expect(result.current.busy).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith("You are not signed in.");
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("reports a browser that fails to unsubscribe instead of throwing", async () => {
    const existing = fakeSubscription();
    existing.unsubscribe.mockRejectedValue(new Error("Push service unavailable"));
    installBrowser("granted", existing);
    serverSays(true, true);
    const { result } = await settled();

    await invoke(() => result.current.disable());

    // The server has already forgotten it, so nothing more will be sent here.
    expect(result.current.state.status).toBe("off");
    expect(result.current.busy).toBe(false);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith("Daily reminders are off for this browser.");
  });

  it("does nothing unless reminders are currently on", async () => {
    installBrowser("default");
    serverSays(true, false);
    const { result } = await settled();

    await invoke(() => result.current.disable());

    expect(transport.unsubscribePush).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("off");
  });
});
