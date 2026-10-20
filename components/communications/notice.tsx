"use client";

import type { ReactNode } from "react";
import { AlertTriangleIcon } from "lucide-react";

/** A short boxed message in a dialog: a warning, or a refusal in red. */
export function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "destructive";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={
        tone === "destructive"
          ? "flex gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm"
          : "flex gap-3 rounded-2xl bg-muted px-4 py-3 text-sm"
      }
    >
      <AlertTriangleIcon
        className={tone === "destructive" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-primary"}
      />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
