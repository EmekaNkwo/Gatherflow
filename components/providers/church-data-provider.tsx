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

  useEffect(() => {
    hydrateSession();
    hydrateChurch();
  }, [hydrateChurch, hydrateSession]);

  if (!ready) return <LoadingShell />;

  return <>{children}</>;
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
