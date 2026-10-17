"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * A dialog that becomes a sheet from the bottom on a phone, so the buttons
 * sit where a thumb can reach them. Same shape as recording a follow-up:
 * a large plain title, a scrolling body and a footer that is always in view.
 *
 * Put the content in `DialogBody` and the buttons in `DialogActions`; both
 * are plain wrappers so a child component can own the form state.
 */
interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Desktop width, e.g. `sm:max-w-xl`. */
  className?: string;
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-0 rounded-t-3xl px-0 pb-0">
          <SheetHeader className="px-5 pt-5 pb-2 pr-12 text-left">
            <SheetTitle className="font-heading text-2xl font-medium">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-md", className)}>
        <DialogHeader className="px-6 pt-6 pb-2 pr-12">
          <DialogTitle className="font-heading text-2xl font-medium">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The scrolling middle of a responsive dialog. */
export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3 text-base sm:px-6", className)}>
      {children}
    </div>
  );
}

/** The footer: Cancel on the left, the one filled action filling the rest. */
export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 border-t bg-popover px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A large tick-box choice, used wherever consent is asked. */
export function ConsentChoice({
  id,
  title,
  hint,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  /** The checkbox itself. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 has-data-checked:border-done has-data-checked:bg-done/8",
        className,
      )}
    >
      {children}
      <span>
        <span className="block font-medium">{title}</span>
        {hint ? <span className="block text-sm text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
