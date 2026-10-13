"use client";

import { useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useChurchStore } from "@/stores/church-store";
import { useSessionStore } from "@/stores/session-store";

/**
 * Loads church data from browser storage before any feature renders.
 *
 * Storage only exists in the browser, so hydration happens in an effect and
 * the shell shows skeletons until the data is ready. Feature hooks can then
 * assume a snapshot exists rather than each handling a null case.
 */
export function ChurchDataProvider({ children }: { children: ReactNode }) {
  const hydrateChurch = useChurchStore((state) => state.hydrate);
  const hydrateSession = useSessionStore((state) => state.hydrate);
  const ready = useChurchStore((state) => state.status === "ready" && state.snapshot !== null);
  const loadError = useChurchStore((state) => state.loadError);

  useEffect(() => {
    hydrateSession();
    void hydrateChurch();
  }, [hydrateChurch, hydrateSession]);

  // In server-backed mode the church may genuinely be unreachable. Saying so
  // beats a skeleton that never resolves, and inventing an empty church would
  // invite somebody to edit a fiction.
  if (loadError) return <UnavailableShell message={loadError} />;

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
