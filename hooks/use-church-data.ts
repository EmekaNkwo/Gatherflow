"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { Result } from "@/lib/result";
import type { CommandResult } from "@/services/core/events";
import type {
  CommandInput,
  CommandName,
  CommandOutput,
} from "@/services/commands/registry";
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

export interface CommandOptions {
  undoLabel?: string;
  silent?: boolean;
  successMessage?: string;
}

export interface CommandRunner {
  /**
   * Runs a named domain command, shows the result as a toast and returns it so
   * callers can close dialogs or navigate on success.
   *
   * Asynchronous because in server-backed mode the command is decided by the
   * server. In local mode it still resolves immediately.
   */
  dispatch: <N extends CommandName>(
    name: N,
    input: CommandInput<N>,
    options?: CommandOptions,
  ) => Promise<Result<CommandResult & CommandOutput<N>>>;
  /**
   * @deprecated Closure form, local mode only. Use `dispatch`.
   */
  run: <T>(command: Command<T>, options?: CommandOptions) => Result<CommandResult & T>;
  undo: () => void;
  canUndo: boolean;
  undoLabel?: string;
}

export function useCommand(): CommandRunner {
  const runCommand = useChurchStore((state) => state.run);
  const dispatchCommand = useChurchStore((state) => state.dispatch);
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

  /**
   * Reports a command's outcome. Shared by both forms so a refusal and a
   * success are presented identically however the command was invoked.
   */
  const report = useCallback(
    (outcome: Result<CommandResult>, options?: CommandOptions) => {
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      if (options?.silent) return;

      const [headline, ...rest] = options?.successMessage
        ? [options.successMessage, ...outcome.value.notices]
        : outcome.value.notices;

      if (headline) {
        toast.success(headline, {
          description: rest.length ? rest.join(" ") : undefined,
          action: options?.undoLabel ? { label: "Undo", onClick: () => undo() } : undefined,
        });
      }
    },
    [undo],
  );

  const dispatch = useCallback<CommandRunner["dispatch"]>(
    async (name, input, options) => {
      const outcome = await dispatchCommand(name, input, {
        undoLabel: options?.undoLabel,
      });
      report(outcome, options);
      return outcome;
    },
    [dispatchCommand, report],
  );

  return { dispatch, run, undo, canUndo: Boolean(undoEntry), undoLabel: undoEntry?.label };
}
