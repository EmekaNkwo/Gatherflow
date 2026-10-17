import { err, ok, type Result } from "@/lib/result";
import type { LoadReport } from "@/services/repositories/collection";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { EmailAvailability, SendEmailReceipt, SendEmailRequest } from "@/types/email";
import type { InvitationDelivery } from "@/types/account";
import type { DemoRole } from "@/types/team";
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
  email: EmailAvailability;
  /** Churches the account belongs to; more than one means a switch is offered. */
  memberships?: number;
  /** The role and team member the server resolved for this session. */
  actingAs?: { role: DemoRole; teamMemberId: string | null };
  /** The church this session opened; the public welcome link needs it. */
  churchId?: string;
}

export interface RemoteEmailResult {
  snapshot: ChurchSnapshot;
  notices: string[];
  data: SendEmailReceipt;
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

/**
 * Asks the server to queue an email. Not a registry command: the local mode
 * cannot perform this at all, and the server needs more than a snapshot to
 * decide it (the suppression list, the provider configuration).
 */
export async function postEmail(input: SendEmailRequest): Promise<Result<RemoteEmailResult>> {
  try {
    const response = await fetch("/api/church/email", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
    return parse<RemoteEmailResult>(response);
  } catch (error: unknown) {
    return err(transportMessage(error), "transport");
  }
}

/** Signs the session out. The caller reloads so no church data lingers. */
async function forgetPushSubscription(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch(`/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE" });
    await subscription.unsubscribe();
  } catch {
    // Signing out must not fail because the browser's push state could not be read.
  }
}

export async function postSignOut(): Promise<void> {
  try {
    // Daily reminders belong to the person, not the browser: on a shared
    // computer the next person must not get this one's counts.
    await forgetPushSubscription();
    // The church choice goes first, so the next person on this browser is
    // asked rather than handed the previous person's pick.
    await fetch("/api/churches/select", { method: "DELETE" });
    await fetch("/api/auth/sign-out", { method: "POST", headers: { accept: "application/json" } });
  } catch {
    // Nothing to do: the reload that follows will find no session either way.
  }
}

function transportMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "That request was cancelled.";
  }
  return "Could not reach the server. Your change has not been saved.";
}

export interface RemoteEmailStatus {
  availability: EmailAvailability;
  failures: Array<{
    outboxId: string;
    communicationId: string;
    personId: string;
    toEmail: string;
    subject: string;
    attempts: number;
    lastError: string | null;
    updatedAt: string;
  }>;
}

/** The church's email status: whether sending is offered, and what gave up. */
export async function fetchEmailStatus(signal?: AbortSignal): Promise<Result<RemoteEmailStatus>> {
  try {
    const response = await fetch("/api/church/email", {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
      cache: "no-store",
    });
    return parse<RemoteEmailStatus>(response);
  } catch (error: unknown) {
    return err(transportMessage(error), "transport");
  }
}

export interface AuditEntry {
  id: string;
  userId: string;
  actorId: string | null;
  action: string;
  targetId: string | null;
  outcome: string;
  code: string | null;
  at: string;
}

/** The server's record of who did what, for an administrator. */
export async function fetchAudit(signal?: AbortSignal): Promise<Result<{ entries: AuditEntry[] }>> {
  try {
    const response = await fetch("/api/church/audit", {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
      cache: "no-store",
    });
    return parse<{ entries: AuditEntry[] }>(response);
  } catch (error: unknown) {
    return err(transportMessage(error), "transport");
  }
}

// --- Accounts and invitations ---------------------------------------------

export interface AccountMember {
  userId: string;
  email: string;
  name: string;
  role: DemoRole;
  teamMemberId: string | null;
  since: string;
  self: boolean;
}

export type { InvitationDelivery };

export interface Invitation {
  id: string;
  email: string;
  role: DemoRole;
  teamMemberId: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { accept: "application/json", "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    return parse<T>(response);
  } catch (error: unknown) {
    return err(transportMessage(error), "transport");
  }
}

export const fetchMembers = () => call<{ members: AccountMember[] }>("/api/church/members");

export const setMemberRole = (userId: string, role: DemoRole) =>
  call<{ userId: string; role: DemoRole }>("/api/church/members", {
    method: "PATCH",
    body: JSON.stringify({ userId, role }),
  });

export const removeMember = (userId: string) =>
  call<{ removed: boolean }>(`/api/church/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });

export const fetchInvitations = () => call<{ invitations: Invitation[] }>("/api/church/invitations");

export const createInvitation = (input: { email: string; role: DemoRole; teamMemberId?: string }) =>
  call<{ invitation: Invitation; link: string; delivery: InvitationDelivery }>("/api/church/invitations", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Starts a change of address; the account moves once the new address confirms. */
export const changeAccountEmail = (input: { newEmail: string; password: string }) =>
  call<{ pending: boolean; newEmail: string }>("/api/account/email", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteAccount = (password: string) =>
  call<{ deleted: boolean }>("/api/account/delete", { method: "POST", body: JSON.stringify({ password }) });

/** Whether this deployment can push reminders, and whether this browser is subscribed. */
export const fetchPushStatus = (endpoint?: string) =>
  call<{ available: boolean; publicKey: string | null; subscribed: boolean }>(
    `/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`,
  );

export const subscribePush = (subscription: PushSubscriptionJSON) =>
  call<{ subscribed: boolean }>("/api/push", { method: "POST", body: JSON.stringify(subscription) });

export const unsubscribePush = (endpoint: string) =>
  call<{ subscribed: boolean }>(`/api/push?endpoint=${encodeURIComponent(endpoint)}`, { method: "DELETE" });

export const revokeInvitation = (id: string) =>
  call<{ removed: boolean }>(`/api/church/invitations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
