"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { Result } from "@/lib/result";
import type { CommandResult } from "@/services/core/events";
import { useChurchStore, type Command } from "@/stores/church-store";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * Base access to church data.
 *
 * Feature hooks build on these two primitives: `useSnapshot` for reading and
 * `useCommand` for writing. No component reads the store or the repository
 * directly.
 */
export function useSnapshot(): ChurchSnapshot {
  const snapshot = useChurchStore((state) => state.snapshot);
  if (!snapshot) {
    throw new Error(
      "Church data has not been loaded. Render this inside <ChurchDataProvider>.",
    );
  }
  return snapshot;
}

export function useIsReady(): boolean {
  return useChurchStore((state) => state.status === "ready" && state.snapshot !== null);
}

export interface CommandRunner {
  /**
   * Runs a domain command, shows the result as a toast and returns it so
   * callers can close dialogs or navigate on success.
   */
  run: <T>(
    command: Command<T>,
    options?: { undoLabel?: string; silent?: boolean; successMessage?: string },
  ) => Result<CommandResult & T>;
  undo: () => void;
  canUndo: boolean;
  undoLabel?: string;
}

export function useCommand(): CommandRunner {
  const runCommand = useChurchStore((state) => state.run);
  const undoCommand = useChurchStore((state) => state.undo);
  const undoEntry = useChurchStore((state) => state.undoEntry);

  const undo = useCallback(() => {
    const outcome = undoCommand();
    if (outcome.ok) toast.success(`Undone: ${outcome.value}`);
    else toast.error(outcome.error);
  }, [undoCommand]);

  const run = useCallback<CommandRunner["run"]>(
    (command, options) => {
      const outcome = runCommand(command, { undoLabel: options?.undoLabel });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return outcome;
      }

      if (!options?.silent) {
        const [headline, ...rest] = options?.successMessage
          ? [options.successMessage, ...outcome.value.notices]
          : outcome.value.notices;

        if (headline) {
          toast.success(headline, {
            description: rest.length ? rest.join(" ") : undefined,
            action: options?.undoLabel
              ? { label: "Undo", onClick: () => undo() }
              : undefined,
          });
        }
      }

      return outcome;
    },
    [runCommand, undo],
  );

  return { run, undo, canUndo: Boolean(undoEntry), undoLabel: undoEntry?.label };
}
