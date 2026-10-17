import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/layout/brand-mark";

/**
 * The frame of a church's public welcome page. It should feel like it comes
 * from the church, not from software: the church's name leads, and
 * GatherFlow only signs off quietly at the bottom.
 */
export function WelcomeShell({ churchName, children }: { churchName?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-6 px-4 pt-5 pb-8 sm:px-8 sm:pt-10">
      <header className="flex min-h-11 items-center gap-3">
        {churchName ? (
          <>
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xl font-medium text-primary-foreground"
            >
              {initial(churchName)}
            </span>
            <p className="min-w-0 truncate font-heading text-lg font-medium">{churchName}</p>
          </>
        ) : null}
      </header>

      <main className="flex flex-col gap-8">{children}</main>

      <footer className="mt-auto space-y-3 pt-6 text-sm text-muted-foreground">
        <p className="text-pretty">
          Your details go only to {churchName ? `${churchName}'s` : "the church's"} welcome team.
          This page shows nothing about anyone else.
        </p>
        <p className="flex items-center gap-2">
          <BrandMark className="size-5" />
          Made with GatherFlow
        </p>
      </footer>
    </div>
  );
}

/**
 * The moment after a visitor says hello: a warm, unhurried thank-you, what
 * happens next in plain words, and a way to add the person they came with.
 */
export function WelcomeThanks({
  churchName,
  firstName,
  contacted,
  onAnother,
}: {
  churchName: string;
  firstName: string;
  contacted: boolean;
  onAnother: () => void;
}) {
  return (
    <section
      className="flex flex-col items-start rounded-[2rem] bg-warm px-6 py-10 animate-in fade-in-0 zoom-in-95 duration-500 sm:px-8"
    >
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full bg-done text-done-foreground"
      >
        <CheckIcon className="size-8" strokeWidth={2.5} />
      </span>
      <div role="status">
        <h1 className="mt-6 text-[clamp(2.25rem,8vw,3rem)] leading-none font-medium">Thank you</h1>
        <p className="mt-4 text-lg text-pretty">
          {firstName ? `${firstName}, it` : "It"} was lovely to have you at {churchName}.
        </p>
        <p className="mt-3 text-base text-pretty text-muted-foreground">
          {contacted
            ? "Someone from the welcome team will be in touch this week, just to say hello."
            : "We won't contact you. If you'd like to hear from us later, just tell someone on the welcome desk."}
        </p>
      </div>
      <Button
        variant="outline"
        size="lg"
        className="mt-8 h-12 w-full rounded-full text-base sm:w-auto sm:px-8"
        onClick={onAnother}
      >
        Add someone you came with
      </Button>
    </section>
  );
}

function initial(name: string): string {
  const letter = name.trim().replace(/^the\s+/i, "").charAt(0);
  return letter ? letter.toUpperCase() : "·";
}
