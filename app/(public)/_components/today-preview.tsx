import { CheckIcon } from "lucide-react";

interface PreviewPerson {
  initial: string;
  name: string;
  note: string;
  action: string;
  primary: boolean;
}

const WAITING: readonly PreviewPerson[] = [
  {
    initial: "D",
    name: "Daniel Okafor",
    note: "First visit on Sunday · prefers WhatsApp",
    action: "Say hello",
    primary: true,
  },
  {
    initial: "R",
    name: "Ruth Mensah",
    note: "Back for a second Sunday · a call is best",
    action: "Call",
    primary: false,
  },
];

/**
 * An illustration of a volunteer's Monday, built from the same shapes as the
 * real Today screen rather than a screenshot, so it stays sharp, follows dark
 * mode and reads at any size. Purely decorative to assistive technology; the
 * caption says what it shows.
 */
export function TodayPreview() {
  return (
    <figure className="relative isolate mx-auto w-full max-w-sm">
      <div
        aria-hidden
        className="absolute inset-x-1 top-10 bottom-8 -z-10 rounded-[2.75rem] bg-accent sm:-inset-x-6"
      />
      <div aria-hidden className="rounded-[2.25rem] border bg-background p-3 shadow-xl shadow-foreground/5">
        <div className="rounded-[1.75rem] bg-warm px-5 py-6">
          <p className="text-xs font-medium text-muted-foreground">Monday 13 October</p>
          <p className="mt-1 font-heading text-[1.75rem] leading-tight font-medium">
            Good afternoon, Grace
          </p>
          <p className="mt-2 text-base">Two people to reach today.</p>
        </div>

        <p className="mt-5 px-2 font-heading text-lg font-medium">Today</p>
        <ul className="mt-2 divide-y overflow-hidden rounded-3xl border bg-card">
          {WAITING.map((person) => (
            <li key={person.name} className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-heading font-medium">
                {person.initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{person.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{person.note}</span>
              </span>
              <span
                className={
                  person.primary
                    ? "shrink-0 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground"
                    : "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium"
                }
              >
                {person.action}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 bg-done/8 px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-done text-done-foreground">
              <CheckIcon className="size-5" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">Thomas Reid</span>
              <span className="block truncate text-xs text-done">
                Called · coming to the coffee morning
              </span>
            </span>
          </li>
        </ul>
      </div>
      <figcaption className="mt-6 text-center text-sm text-muted-foreground">
        What Grace, one of the volunteers, sees on her phone on Monday.
      </figcaption>
    </figure>
  );
}
