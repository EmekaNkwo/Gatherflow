import { act, cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { toast } from "sonner";
import { createSeedSnapshot } from "@/data/seed";
import { err, ok } from "@/lib/result";
import * as client from "@/services/commands/client";
import { useChurchStore } from "@/stores/church-store";
import { useSessionStore } from "@/stores/session-store";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { DemoRole } from "@/types/team";
import type { EmailAvailability } from "@/types/email";

/**
 * Shared harness for the hook suites.
 *
 * Each suite mocks the transport and the toast at the top of the file:
 *
 *   vi.mock("@/services/commands/client");
 *   vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
 *
 * The harness then seeds the real church and session stores, freezes the
 * clock, and lets a test script what the server answers to a command.
 */

export const NOW = new Date("2026-10-12T09:00:00.000Z");
export const TODAY = "2026-10-12";

const baseSnapshot = createSeedSnapshot(NOW);

/** A fresh, deterministic copy of the demo church at `NOW`. */
export function seedSnapshot(): ChurchSnapshot {
  return structuredClone(baseSnapshot);
}

export interface SeedOptions {
  role?: DemoRole;
  teamMemberId?: string | null;
  snapshot?: ChurchSnapshot;
  email?: EmailAvailability;
}

/**
 * Loads a church into the store as if the server had answered, and sets who
 * the session is acting as. Returns the snapshot the hooks will read.
 */
export function seedChurch(options: SeedOptions = {}): ChurchSnapshot {
  const snapshot = options.snapshot ?? seedSnapshot();
  useChurchStore.setState({
    snapshot,
    status: "ready",
    ...(options.email ? { email: options.email } : {}),
  });
  useSessionStore.setState({
    role: options.role ?? "administrator",
    teamMemberId: options.teamMemberId === undefined ? null : options.teamMemberId,
    resolved: true,
  });
  return snapshot;
}

/** Freezes `Date` at `NOW` while leaving real timers in place. */
export function freezeTime(at: Date = NOW): void {
  vi.useFakeTimers({ toFake: ["Date"], now: at });
}

/** The mocked transport functions, typed. */
export const transport = {
  postCommand: vi.mocked(client.postCommand),
  postEmail: vi.mocked(client.postEmail),
  fetchPushStatus: vi.mocked(client.fetchPushStatus),
  subscribePush: vi.mocked(client.subscribePush),
  unsubscribePush: vi.mocked(client.unsubscribePush),
};

export const toastMock = {
  success: vi.mocked(toast.success),
  error: vi.mocked(toast.error),
  info: vi.mocked(toast.info),
};

/**
 * The server accepts the next command. `change` derives the snapshot the
 * server returns from the current one, so a test can see the store adopt it.
 */
export function acceptCommands(
  options: {
    notices?: string[];
    data?: Record<string, unknown>;
    change?: (snapshot: ChurchSnapshot) => ChurchSnapshot;
  } = {},
): void {
  transport.postCommand.mockImplementation(async () => {
    const current = useChurchStore.getState().snapshot ?? seedSnapshot();
    const next = options.change ? options.change(current) : current;
    return ok({ snapshot: next, notices: options.notices ?? [], data: options.data ?? {} });
  });
}

/** The server refuses the next command. */
export function refuseCommands(error: string, code = "refused"): void {
  transport.postCommand.mockResolvedValue(err(error, code));
}

/** The name and input of the most recent command the hook sent. */
export function lastCommand(): { name: string; input: unknown } {
  const call = transport.postCommand.mock.calls.at(-1);
  if (!call) throw new Error("No command was dispatched.");
  return { name: call[0], input: call[1] };
}

/** Runs a hook action inside `act` and hands back what it resolved to. */
export async function invoke<T>(action: () => T | Promise<T>): Promise<T> {
  let outcome: T | undefined;
  await act(async () => {
    outcome = await action();
  });
  return outcome as T;
}

/** Puts both stores back to their pristine state and the clock back to real time. */
export function resetHarness(): void {
  // Unmount first: emptying the store under a mounted hook would make
  // `useSnapshot` throw during the re-render.
  cleanup();
  useChurchStore.setState(useChurchStore.getInitialState(), true);
  useSessionStore.setState(useSessionStore.getInitialState(), true);
  vi.useRealTimers();
  vi.clearAllMocks();
}
