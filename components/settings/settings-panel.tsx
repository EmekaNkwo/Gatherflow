import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

interface SettingsPanelProps {
  title: string;
  description?: ReactNode;
  /** Small status shown beside the title, such as "On" or "Not set up". */
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** One calm block of settings: a title, one line of explanation, the form. */
export function SettingsPanel({ title, description, status, children, className }: SettingsPanelProps) {
  return (
    <section className={cn("space-y-4 rounded-3xl border bg-card p-5 md:p-6", className)}>
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-medium">
          {title}
          {status}
        </h2>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

interface DisclosureButtonProps {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  controls?: string;
}

/** Shows or hides the rarer settings underneath it. */
export function DisclosureButton({ open, onToggle, children, controls }: DisclosureButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 gap-1.5 rounded-full px-4"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {children}
      <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
    </Button>
  );
}
