"use client";

import { create } from "zustand";
import { err, ok, type Result } from "@/lib/result";
import type { LoadReport } from "@/services/repositories/collection";
import {
  fetchChurch,
  newRequestId,
  postCommand,
  postEmail,
} from "@/services/commands/client";
import type {
  CommandInput,
  CommandName,
  CommandResultOf,
} from "@/services/commands/registry";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { DemoRole } from "@/types/team";
import {
  EMAIL_UNAVAILABLE,
  type EmailAvailability,
  type SendEmailReceipt,
  type SendEmailRequest,
} from "@/types/email";

/**
 * The single source of truth for church data in the browser.
 *
 * Components never mutate this state. They call `dispatch` with a command
 * name and its input; the server authorises it, re-runs the rules itself and
 * returns the new snapshot. The browser never tells the server what the
 * answer is, and nothing lives here that the server does not know.
 */
export interface ActingAs {
  role: DemoRole;
  teamMemberId: string | null;
}

export interface ChurchStore {
  snapshot: ChurchSnapshot | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  /** True when this church was just created and has nothing in it yet. */
  seeded: boolean;
  report: LoadReport | null;
  /** Notices from the most recent command, for toast display. */
  lastNotices: string[];
  /** Set when the church could not be loaded. */
  loadError: string | null;
  /** The refusal code behind `loadError`, so "not signed in" can be told apart. */
  loadErrorCode: string | null;
  /** The server's version at the last load. */
  remoteVersion: number | null;
  /** The church the session opened. */
  churchId: string | null;
  /** Whether the server offers to send email. */
  email: EmailAvailability;
  /** Churches the signed-in account belongs to. */
  memberships: number;
  /** The role and team member the server resolved for this session. */
  actingAs: ActingAs | null;

  hydrate: () => Promise<void>;
  /** Re-reads the church from the server, e.g. after another tab changed it. */
  refresh: () => Promise<void>;
  /**
   * Re-reads the church quietly — no loading state, and a failure leaves what
   * is on screen alone. Used when the window regains focus and after a
   * refusal, which usually means somebody else changed the thing first.
   */
  revalidate: () => Promise<void>;
  /**
   * Runs a named command on the server. Named rather than passed as a
   * function, because a closure cannot cross a network.
   */
  dispatch: <N extends CommandName>(
    name: N,
    input: CommandInput<N>,
  ) => Promise<Result<CommandResultOf<N>>>;
  /** Queues a real email through the server. */
  sendEmail: (input: SendEmailRequest) => Promise<Result<SendEmailReceipt>>;
}

/**
 * Applies the server-resolved role before the church is marked ready, so no
 * render ever sees a stale role. Registered by the session store, which
 * this module cannot import without a cycle.
 */
let sessionAdopter: (
  role: DemoRole,
  teamMemberId: string | null,
) => void = () => undefined;

export function setSessionAdopter(adopt: typeof sessionAdopter): void {
  sessionAdopter = adopt;
}

/** Refusals that say "the data you acted on is wrong", not "you typed it wrong". */
const STALE_CODES = new Set([
  "not_found",
  "closed",
  "duplicate",
  "opted_out",
  "inactive",
  "terminal",
  "conflict",
  "in_progress",
]);

/**
 * Commands in flight, keyed by name and input. A second identical request
 * while the first is still on its way — a double tap, Enter pressed twice —
 * shares the first one's answer instead of doing the thing twice.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Request ids of commands that never got an answer. Trying the same thing
 * again reuses the id, so if the first attempt did reach the server after all,
 * the server recognises it and does not do it twice.
 */
const unanswered = new Map<string, string>();

export const useChurchStore = create<ChurchStore>((set, get) => {
  async function load(): Promise<void> {
    set({ status: "loading", loadError: null, loadErrorCode: null });
    const loaded = await fetchChurch();
    if (!loaded.ok) {
      // Nothing is invented on failure: an empty church would look like a
      // real one, and the user would edit a fiction.
      set({
        status: "unavailable",
        loadError: loaded.error,
        loadErrorCode: loaded.code ?? null,
        snapshot: null,
      });
      return;
    }
    if (loaded.value.actingAs) {
      sessionAdopter(
        loaded.value.actingAs.role,
        loaded.value.actingAs.teamMemberId,
      );
    }
    set({
      snapshot: loaded.value.snapshot,
      seeded: loaded.value.seeded,
      report: loaded.value.report,
      remoteVersion: loaded.value.version,
      churchId: loaded.value.churchId ?? null,
      email: loaded.value.email ?? EMAIL_UNAVAILABLE,
      memberships: loaded.value.memberships ?? 1,
      actingAs: loaded.value.actingAs ?? null,
      status: "ready",
    });
  }

  return {
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

    hydrate: async () => {
      if (get().status === "ready" || get().status === "loading") return;
      await load();
    },

    refresh: load,

    revalidate: async () => {
      if (get().status !== "ready") return;
      // Best effort: a failed or thrown re-read leaves what is on screen alone.
      let loaded: Awaited<ReturnType<typeof fetchChurch>> | undefined;
      try {
        loaded = await fetchChurch();
      } catch {
        return;
      }
      if (loaded?.ok)
        set({
          snapshot: loaded.value.snapshot,
          remoteVersion: loaded.value.version,
        });
    },

    dispatch: (name, input) => {
      const key = `${name}:${JSON.stringify(input)}`;
      const pending = inFlight.get(key) as
        ReturnType<ChurchStore["dispatch"]> | undefined;
      if (pending) return pending as never;

      const requestId = unanswered.get(key) ?? newRequestId();
      const request = send(name, input, requestId)
        .then((outcome) => {
          if (!outcome.ok && outcome.code === "transport")
            unanswered.set(key, requestId);
          else unanswered.delete(key);
          return outcome;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request;
    },

    sendEmail: async (input) => {
      const posted = await postEmail(input);
      if (!posted.ok) return posted;
      set({
        snapshot: posted.value.snapshot,
        lastNotices: posted.value.notices,
      });
      return ok(posted.value.data);
    },
  };

  async function send<N extends CommandName>(
    name: N,
    input: CommandInput<N>,
    requestId: string,
  ): Promise<Result<CommandResultOf<N>>> {
    type Outcome = Result<CommandResultOf<N>>;
    const posted = await postCommand(name, input, requestId);
    if (!posted.ok) {
      // What is on screen was out of date; show what is true now.
      if (posted.code && STALE_CODES.has(posted.code)) void get().revalidate();
      return posted as Outcome;
    }

    set({ snapshot: posted.value.snapshot, lastNotices: posted.value.notices });

    return ok({
      snapshot: posted.value.snapshot,
      events: [],
      notices: posted.value.notices,
      ...posted.value.data,
    } as CommandResultOf<N>);
  }
});

/** Reads the snapshot outside React (tests, one-off exports). */
export function currentSnapshot(): ChurchSnapshot | null {
  return useChurchStore.getState().snapshot;
}

export function notReady<T>(): Result<T> {
  return err("The church data is still loading.", "not_ready");
}
