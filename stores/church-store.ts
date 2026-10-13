"use client";

import { create } from "zustand";
import { createSeedSnapshot } from "@/data/seed";
import { err, ok, type Result } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { createCommandContext, type CommandContext } from "@/services/core/context";
import type { CommandResult } from "@/services/core/events";
import type { LoadReport } from "@/services/repositories/collection";
import {
  createSnapshotRepository,
  type ExportBundle,
  type SnapshotRepository,
} from "@/services/repositories/snapshot-repository";
import { createLocalStorage, type StorageAdapter } from "@/services/repositories/storage";
import { fetchChurch, postCommand } from "@/services/commands/client";
import {
  COMMANDS,
  type CommandInput,
  type CommandName,
  type CommandOutput,
} from "@/services/commands/registry";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * The single source of truth for church data.
 *
 * Components never mutate this state. They call `run` with a domain command,
 * which produces a new snapshot; the store then applies the automation rules
 * once, persists only the collections that changed, and keeps one step of
 * undo. Because every mutation goes through here, rules can never fire twice
 * for the same action.
 */
export interface CommandOutcome {
  notices: string[];
}

export type Command<T> = (
  snapshot: ChurchSnapshot,
  ctx: CommandContext,
) => Result<CommandResult & T>;

interface UndoEntry {
  snapshot: ChurchSnapshot;
  label: string;
}

/**
 * Where the church lives.
 *
 * `local` keeps everything in the browser, which is what the public demo runs
 * on: no account, no server, no setup. `remote` sends every command to the
 * server, which authorises it, re-runs the rules itself and decides the new
 * state. The browser never tells the server what the answer is.
 */
export type ChurchMode = "local" | "remote";

export interface ChurchStore {
  snapshot: ChurchSnapshot | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  seeded: boolean;
  report: LoadReport | null;
  undoEntry: UndoEntry | null;
  /** Notices from the most recent command, for toast display. */
  lastNotices: string[];
  mode: ChurchMode;
  /** Set when the remote church could not be loaded. */
  loadError: string | null;
  /** The server's version at the last load; null in local mode. */
  remoteVersion: number | null;

  hydrate: () => Promise<void>;
  /**
   * Runs a named command.
   *
   * Named rather than passed as a function, because a closure cannot cross a
   * network. In `local` mode the name is looked up in the registry and run
   * here; in `remote` mode it is posted to the server, which looks up the same
   * entry. Both paths therefore run identical rules.
   */
  dispatch: <N extends CommandName>(
    name: N,
    input: CommandInput<N>,
    options?: { undoLabel?: string },
  ) => Promise<Result<CommandResult & CommandOutput<N>>>;
  /**
   * @deprecated Closure form, kept while hooks migrate to `dispatch`. It only
   * works in `local` mode, because a closure cannot be sent to a server.
   */
  run: <T>(command: Command<T>, options?: { undoLabel?: string }) => Result<CommandResult & T>;
  undo: () => Result<string>;
  reset: () => void;
  exportBundle: () => ExportBundle | null;
  importBundle: (raw: unknown) => Result<string>;
  /** Replaces the storage adapter — used by tests. */
  configureStorage: (adapter: StorageAdapter, now?: () => Date) => void;
  /** Switches to the server-backed mode. Called once, during startup. */
  configureMode: (mode: ChurchMode) => void;
}

let repository: SnapshotRepository | null = null;
let clock: () => Date = () => new Date();

function getRepository(): SnapshotRepository {
  repository ??= createSnapshotRepository(createLocalStorage(), () => createSeedSnapshot(clock()));
  return repository;
}

/** The team member whose identity commands are recorded against. */
let actorResolver: () => string = () => "tm_admin_ruth";

export function setActorResolver(resolve: () => string): void {
  actorResolver = resolve;
}

export const useChurchStore = create<ChurchStore>((set, get) => ({
  snapshot: null,
  status: "idle",
  seeded: false,
  report: null,
  undoEntry: null,
  lastNotices: [],
  // Local by default: the public demo must work with no account and no server.
  mode: "local",
  loadError: null,
  remoteVersion: null,

  hydrate: async () => {
    if (get().status === "ready" || get().status === "loading") return;

    if (get().mode === "remote") {
      set({ status: "loading", loadError: null });
      const loaded = await fetchChurch();
      if (!loaded.ok) {
        // Nothing is invented on failure: an empty church would look like a
        // real one, and the user would edit a fiction.
        set({ status: "unavailable", loadError: loaded.error, snapshot: null });
        return;
      }
      set({
        snapshot: loaded.value.snapshot,
        seeded: loaded.value.seeded,
        report: loaded.value.report,
        remoteVersion: loaded.value.version,
        status: "ready",
      });
      return;
    }

    const loaded = getRepository().load();

    // Records that failed validation were dropped from the snapshot. Write
    // the cleaned data back, so the problem is actually repaired rather than
    // re-reported on every reload.
    if (loaded.report.dropped > 0) {
      getRepository().save(null, loaded.snapshot);
    }

    set({
      snapshot: loaded.snapshot,
      seeded: loaded.seeded,
      report: loaded.report,
      status: "ready",
    });
  },

  dispatch: async (name, input, options) => {
    type Outcome = Result<CommandResult & CommandOutput<typeof name>>;

    if (get().mode === "remote") {
      const posted = await postCommand(name, input);
      if (!posted.ok) return posted as Outcome;

      const previous = get().snapshot;
      set({
        snapshot: posted.value.snapshot,
        lastNotices: posted.value.notices,
        // Undo is local-only: the server is the authority on its own history,
        // and replaying a stale snapshot over it would discard other people's
        // work. Offering the button here would be a lie.
        undoEntry: null,
      });
      void previous;

      return ok({
        snapshot: posted.value.snapshot,
        events: [],
        notices: posted.value.notices,
        ...posted.value.data,
      } as CommandResult & CommandOutput<typeof name>);
    }

    const { snapshot } = get();
    if (!snapshot) return err("The church data is still loading.", "not_ready") as Outcome;

    const definition = COMMANDS[name];
    const ctx = createCommandContext({ actorId: actorResolver(), now: clock() });

    const outcome = definition.run(snapshot, input as never, ctx) as Outcome;
    if (!outcome.ok) return outcome;

    // Automations run exactly once per command, against the events the
    // command reported — never off the back of a re-render.
    const automated = runAutomations(outcome.value.snapshot, outcome.value.events, ctx);
    const notices = [...outcome.value.notices, ...automated.notices];

    getRepository().save(snapshot, automated.snapshot);

    set({
      snapshot: automated.snapshot,
      lastNotices: notices,
      undoEntry: options?.undoLabel
        ? { snapshot, label: options.undoLabel }
        : get().undoEntry,
    });

    return ok({
      ...outcome.value,
      snapshot: automated.snapshot,
      notices,
    }) as Outcome;
  },

  run: (command, options) => {
    const { snapshot } = get();
    if (!snapshot) return err("The church data is still loading.", "not_ready");

    const ctx = createCommandContext({ actorId: actorResolver(), now: clock() });
    const outcome = command(snapshot, ctx);
    if (!outcome.ok) return outcome;

    // Automations run exactly once per command, against the events the
    // command reported — never off the back of a re-render.
    const automated = runAutomations(outcome.value.snapshot, outcome.value.events, ctx);
    const notices = [...outcome.value.notices, ...automated.notices];

    getRepository().save(snapshot, automated.snapshot);

    set({
      snapshot: automated.snapshot,
      lastNotices: notices,
      undoEntry: options?.undoLabel
        ? { snapshot, label: options.undoLabel }
        : get().undoEntry,
    });

    return ok({ ...outcome.value, snapshot: automated.snapshot, notices });
  },

  undo: () => {
    const entry = get().undoEntry;
    if (!entry) return err("There is nothing to undo.", "empty");
    getRepository().save(get().snapshot, entry.snapshot);
    set({ snapshot: entry.snapshot, undoEntry: null, lastNotices: [`Undone: ${entry.label}.`] });
    return ok(entry.label);
  },

  reset: () => {
    const snapshot = getRepository().reset();
    set({
      snapshot,
      seeded: true,
      undoEntry: null,
      report: { dropped: 0, issues: [] },
      lastNotices: ["Demo data restored to the original seed."],
    });
  },

  exportBundle: () => {
    const { snapshot } = get();
    return snapshot ? getRepository().exportBundle(snapshot) : null;
  },

  importBundle: (raw) => {
    const { snapshot } = get();
    if (!snapshot) return err("The church data is still loading.", "not_ready");

    const imported = getRepository().importBundle(raw, snapshot);
    if (!imported.ok) return imported;

    getRepository().save(null, imported.value);
    set({
      snapshot: imported.value,
      undoEntry: { snapshot, label: "data import" },
      lastNotices: ["Demo data imported. Pastoral-care records were not included."],
    });
    return ok("Data imported.");
  },

  configureStorage: (adapter, now) => {
    clock = now ?? (() => new Date());
    repository = createSnapshotRepository(adapter, () => createSeedSnapshot(clock()));
    set({ snapshot: null, status: "idle", undoEntry: null, lastNotices: [] });
  },

  configureMode: (mode) => {
    set({
      mode,
      snapshot: null,
      status: "idle",
      undoEntry: null,
      lastNotices: [],
      loadError: null,
      remoteVersion: null,
    });
  },
}));

/** Reads the snapshot outside React (tests, one-off exports). */
export function currentSnapshot(): ChurchSnapshot | null {
  return useChurchStore.getState().snapshot;
}
