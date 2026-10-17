"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useChurchStore } from "@/stores/church-store";
import { useSessionStore } from "@/stores/session-store";

/**
 * Loads the church from the server before any feature renders, and sends
 * the person where they need to be when it cannot: to sign in, to choose a
 * church, or to set one up. Feature hooks can then assume a snapshot exists
 * rather than each handling a null case.
 */
const REDIRECTS: Record<string, string> = {
  unauthenticated: "/sign-in",
  church_required: "/choose-church",
  no_membership: "/onboarding",
};

export function ChurchDataProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const hydrate = useChurchStore((state) => state.hydrate);
  const loaded = useChurchStore((state) => state.status === "ready" && state.snapshot !== null);
  const loadError = useChurchStore((state) => state.loadError);
  const loadErrorCode = useChurchStore((state) => state.loadErrorCode);
  const actingAs = useChurchStore((state) => state.actingAs);
  const resolved = useSessionStore((state) => state.resolved);
  const adoptServerSession = useSessionStore((state) => state.adoptServerSession);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The interface's advisory role is the server's answer. Nothing renders
  // against it until it has been adopted, so no button is ever offered on
  // the strength of a role the server did not grant.
  useEffect(() => {
    if (actingAs) adoptServerSession(actingAs.role, actingAs.teamMemberId);
  }, [actingAs, adoptServerSession]);
  const ready = loaded && resolved;

  const redirect = loadErrorCode ? REDIRECTS[loadErrorCode] : undefined;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  // The church may genuinely be unreachable. Saying so beats a skeleton that
  // never resolves, and inventing an empty church would invite somebody to
  // edit a fiction.
  if (loadError && !redirect) return <UnavailableShell message={loadError} />;

  if (!ready) return <LoadingShell />;

  return <>{children}</>;
}

function UnavailableShell({ message }: { message: string }) {
  return (
    <div className="w-full p-4 lg:p-6">
      <div
        role="alert"
        className="mx-auto max-w-lg space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <h1 className="text-lg font-semibold">The church data could not be loaded</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
      <span className="sr-only">Loading church data</span>
    </div>
  );
}
