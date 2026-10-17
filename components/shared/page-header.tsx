import type { ReactNode } from "react";
import { cn } from "cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

/** Consistent page title block with room for primary actions. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-[1.75rem] leading-tight font-medium md:text-3xl">{title}</h1>
        {description ? <p className="max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Page shell: consistent padding and vertical rhythm. */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl space-y-8 px-4 py-6 md:px-6 lg:px-8", className)}>{children}</div>;
}

interface SectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-medium">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
