import { cn } from "cn";

/**
 * GatherFlow's mark: two arcs drawing in toward a centre — people being
 * gathered — in the church's warm accent. No crosses, no stained glass.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[30%] bg-primary text-primary-foreground",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[62%]">
        <path d="M4.5 13a7.5 7.5 0 0 1 12.8-5.3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M19.5 11a7.5 7.5 0 0 1-12.8 5.3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2.1" fill="currentColor" />
      </svg>
    </span>
  );
}
