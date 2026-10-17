"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, SparklesIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useChurchStore } from "@/stores/church-store";

/**
 * Tells the user when stored records had to be repaired, and welcomes a
 * brand-new church. Recovering quietly would be worse: if records were
 * dropped, the person using the app should know why the numbers changed.
 */
export function DataNotices() {
  const report = useChurchStore((state) => state.report);
  const isNew = useChurchStore((state) => (state.snapshot?.people.length ?? 1) === 0);
  const [dismissed, setDismissed] = useState(false);

  const hasIssues = Boolean(report?.issues.length);
  if (dismissed || (!hasIssues && !isNew)) return null;

  return (
    <div className="space-y-3 px-4 pt-4 lg:px-6">
      {hasIssues ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Some stored records could not be read</AlertTitle>
          <AlertDescription>
            {report?.issues.join(" ")} Everything else loaded as usual.
          </AlertDescription>
        </Alert>
      ) : null}

      {isNew ? (
        <Alert>
          <SparklesIcon />
          <AlertTitle>Welcome to your church</AlertTitle>
          <AlertDescription>
            Nothing has been recorded yet. Start by{" "}
            <Link href="/settings" className="underline">
              checking the settings
            </Link>{" "}
            and{" "}
            <Link href="/visitors/new" className="underline">
              registering your first visitor
            </Link>
            , or invite your team from Settings → Team.
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
