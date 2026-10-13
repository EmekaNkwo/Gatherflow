"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, DatabaseIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useChurchStore } from "@/stores/church-store";

/**
 * Tells the user when stored data had to be repaired or seeded.
 *
 * Recovering quietly would be worse: if records were dropped, the person
 * using the app should know why the numbers changed.
 */
export function DataNotices() {
  const report = useChurchStore((state) => state.report);
  const seeded = useChurchStore((state) => state.seeded);
  const [dismissed, setDismissed] = useState(false);

  const hasIssues = Boolean(report?.issues.length);
  if (dismissed || (!hasIssues && !seeded)) return null;

  return (
    <div className="space-y-3 px-4 pt-4 lg:px-6">
      {hasIssues ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Some stored records could not be read</AlertTitle>
          <AlertDescription>
            {report?.issues.join(" ")} Everything else was restored as usual. You can restore the
            original demo data from <Link href="/settings" className="underline">Settings</Link>.
          </AlertDescription>
        </Alert>
      ) : null}

      {seeded ? (
        <Alert>
          <DatabaseIcon />
          <AlertTitle>Demo data generated</AlertTitle>
          <AlertDescription>
            This browser had no saved data, so a synthetic church was created. Every change from
            here is saved locally in your browser.
          </AlertDescription>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-2 right-2"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            <XIcon />
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
