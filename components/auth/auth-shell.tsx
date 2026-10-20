import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";

/** Account forms share one size: big enough for a thumb and for older eyes. */
export const AUTH_INPUT = "h-12 text-base";

/** The one primary action on an account page: full width, easy to hit. */
export const AUTH_PRIMARY = "h-12 w-full rounded-full text-base";

/**
 * The frame every account page sits in: one calm column, the mark, a short
 * welcoming title, the form, and the helpful links underneath. Nothing else
 * to look at. On wider screens the form rests on a soft card; on a phone it
 * sits straight on the page so nothing is cramped.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-1 flex-col px-4 py-6 sm:items-center sm:justify-center sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-full pr-3 font-heading text-lg font-medium"
        >
          <BrandMark className="size-9" />
          GatherFlow
        </Link>

        <div className="mt-8 sm:mt-6 sm:rounded-3xl sm:border sm:bg-card sm:p-8">
          <h1 className="text-[2rem] leading-tight font-medium text-balance">{title}</h1>
          {description ? (
            <p className="mt-2 text-base text-pretty text-muted-foreground">{description}</p>
          ) : null}
          <div className="mt-7">{children}</div>
        </div>

        {footer ? (
          <div className="mt-6 flex flex-col items-center gap-1 text-center text-base text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** A finished step said kindly, with the sage "done" tick. */
export function AuthDone({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex gap-3 rounded-3xl bg-done/10 px-5 py-4">
      <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-done" aria-hidden />
      <p className="text-base">{children}</p>
    </div>
  );
}

/** A plain link under the form, with a comfortable tap area. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
