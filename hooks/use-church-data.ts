"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { Result } from "@/lib/result";
import type { CommandResult } from "@/services/core/events";
import type { CommandInput, CommandName, CommandResultOf } from "@/services/commands/registry";
import { useChurchStore } from "@/stores/church-store";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * Base access to church data.
 *
 * Feature hooks build on these two primitives: `useSnapshot` for reading and
 * `useCommand` for writing. No component reads the store or the transport
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
  /** Kept for call sites written when undo existed; ignored. */
  undoLabel?: string;
  silent?: boolean;
  successMessage?: string;
}

export interface CommandRunner {
  /**
   * Runs a named domain command on the server, shows the result as a toast
   * and returns it so callers can close dialogs or navigate on success.
   */
  dispatch: <N extends CommandName>(
    name: N,
    input: CommandInput<N>,
    options?: CommandOptions,
  ) => Promise<Result<CommandResultOf<N>>>;
}

export function useCommand(): CommandRunner {
  const dispatchCommand = useChurchStore((state) => state.dispatch);

  const report = useCallback((outcome: Result<CommandResult>, options?: CommandOptions) => {
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    if (options?.silent) return;

    const [headline, ...rest] = options?.successMessage
      ? [options.successMessage, ...outcome.value.notices]
      : outcome.value.notices;

    if (headline) {
      toast.success(headline, { description: rest.length ? rest.join(" ") : undefined });
    }
  }, []);

  const dispatch = useCallback<CommandRunner["dispatch"]>(
    async (name, input, options) => {
      const outcome = await dispatchCommand(name, input);
      report(outcome, options);
      return outcome;
    },
    [dispatchCommand, report],
  );

  return { dispatch };
}
