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

export interface ChurchStore {
  snapshot: ChurchSnapshot | null;
  status: "idle" | "ready";
  seeded: boolean;
  report: LoadReport | null;
  undoEntry: UndoEntry | null;
  /** Notices from the most recent command, for toast display. */
  lastNotices: string[];

  hydrate: () => void;
  run: <T>(command: Command<T>, options?: { undoLabel?: string }) => Result<CommandResult & T>;
  undo: () => Result<string>;
  reset: () => void;
  exportBundle: () => ExportBundle | null;
  importBundle: (raw: unknown) => Result<string>;
  /** Replaces the storage adapter — used by tests. */
  configureStorage: (adapter: StorageAdapter, now?: () => Date) => void;
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

  hydrate: () => {
    if (get().status === "ready") return;
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
}));

/** Reads the snapshot outside React (tests, one-off exports). */
export function currentSnapshot(): ChurchSnapshot | null {
  return useChurchStore.getState().snapshot;
}
