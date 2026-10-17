"use client";

import { create } from "zustand";
import { err, ok, type Result } from "@/lib/result";
import type { LoadReport } from "@/services/repositories/collection";
import { fetchChurch, postCommand, postEmail } from "@/services/commands/client";
import type { CommandInput, CommandName, CommandResultOf } from "@/services/commands/registry";
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
let sessionAdopter: (role: DemoRole, teamMemberId: string | null) => void = () => undefined;

export function setSessionAdopter(adopt: typeof sessionAdopter): void {
  sessionAdopter = adopt;
}

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
      sessionAdopter(loaded.value.actingAs.role, loaded.value.actingAs.teamMemberId);
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

    dispatch: async (name, input) => {
      type Outcome = Result<CommandResultOf<typeof name>>;
      const posted = await postCommand(name, input);
      if (!posted.ok) return posted as Outcome;

      set({ snapshot: posted.value.snapshot, lastNotices: posted.value.notices });

      return ok({
        snapshot: posted.value.snapshot,
        events: [],
        notices: posted.value.notices,
        ...posted.value.data,
      } as CommandResultOf<typeof name>);
    },

    sendEmail: async (input) => {
      const posted = await postEmail(input);
      if (!posted.ok) return posted;
      set({ snapshot: posted.value.snapshot, lastNotices: posted.value.notices });
      return ok(posted.value.data);
    },
  };
});

/** Reads the snapshot outside React (tests, one-off exports). */
export function currentSnapshot(): ChurchSnapshot | null {
  return useChurchStore.getState().snapshot;
}

export function notReady<T>(): Result<T> {
  return err("The church data is still loading.", "not_ready");
}
