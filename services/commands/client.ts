import { err, ok, type Result } from "@/lib/result";
import type { LoadReport } from "@/services/repositories/collection";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandInput, CommandName } from "./registry";

/**
 * Transport for the server-backed mode.
 *
 * The browser sends a command's *name and input*, never a computed snapshot:
 * the server re-runs the rules itself and decides what the new state is. A
 * client that lied about the outcome would simply be ignored.
 */

export interface RemoteSnapshot {
  snapshot: ChurchSnapshot;
  version: number;
  seeded: boolean;
  report: LoadReport;
}

export interface RemoteCommandResult {
  snapshot: ChurchSnapshot;
  notices: string[];
  /** The extra payload the command reported, e.g. a new record's id. */
  data: Record<string, unknown>;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

async function parse<T>(response: Response): Promise<Result<T>> {
  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // A proxy error page or a dropped connection: there is no envelope to read.
    return err(
      `The server responded with ${response.status} and no usable body.`,
      "transport",
    );
  }

  if (!envelope.ok || envelope.data === undefined) {
    return err(envelope.error ?? "The server refused that request.", envelope.code);
  }
  return ok(envelope.data);
}

export async function fetchChurch(signal?: AbortSignal): Promise<Result<RemoteSnapshot>> {
  try {
    const response = await fetch("/api/church", {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
      // Always the server's current view; a cached church is a stale church.
      cache: "no-store",
    });
    return parse<RemoteSnapshot>(response);
  } catch (error: unknown) {
    return err(transportMessage(error), "transport");
  }
}

export async function postCommand<N extends CommandName>(
  name: N,
  input: CommandInput<N>,
): Promise<Result<RemoteCommandResult>> {
  try {
    const response = await fetch("/api/church/commands", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name, input }),
    });
    return parse<RemoteCommandResult>(response);
  } catch (error: unknown) {
    return err(transportMessage(error), "transport");
  }
}

function transportMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "That request was cancelled.";
  }
  return "Could not reach the server. Your change has not been saved.";
}
