import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";
import { LinkButton } from "@/components/shared/link-button";
import { TodayPreview } from "./_components/today-preview";

const WEEK = [
  {
    when: "Sunday",
    text: "Someone new scans the card at the welcome desk and leaves their name. They choose whether the church may get in touch.",
  },
  {
    when: "Monday",
    text: "One person on your team finds them at the top of their list, with the best way to reach them and a kind message ready to send.",
  },
  {
    when: "Later",
    text: "How it went is written down in a sentence, so whoever speaks to them next already knows their story. Nobody is forgotten.",
  },
] as const;

const PROMISES = [
  "Nobody is contacted unless they said yes.",
  "Volunteers see their own list, not the whole church.",
  "Pastoral notes stay with pastors.",
  "Every email carries a working unsubscribe link.",
] as const;

const PRIMARY = "h-12 w-full rounded-full px-7 text-base sm:w-auto";

/**
 * The front door. One warm sentence about what GatherFlow does, a glimpse of
 * what a volunteer actually sees, and the two ways in.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2.5 font-heading text-xl font-medium">
          <BrandMark className="size-9" />
          GatherFlow
        </Link>
        <LinkButton href="/sign-in" variant="ghost" size="lg" className="rounded-full">
          Sign in
        </LinkButton>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="grid grid-cols-[minmax(0,1fr)] items-center gap-14 pt-8 pb-16 sm:pt-14 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pb-24">
          <div>
            <p className="font-medium text-primary">For church welcome teams</p>
            <h1 className="mt-4 text-[clamp(2.5rem,5.5vw+1rem,4.25rem)] leading-[1.04] font-medium text-balance">
              Remember who attended, and make sure every new face hears a friendly hello.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground sm:text-xl">
              GatherFlow turns a name left at the welcome desk into one gentle job for one person on
              your team: who to reach, how, and when. Then it remembers how it went.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <LinkButton href="/sign-up" size="lg" className={PRIMARY}>
                Create your church
              </LinkButton>
              <LinkButton href="/sign-in" variant="outline" size="lg" className={PRIMARY}>
                Sign in
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Set up in a minute. Invite the rest of your team with a link.
            </p>
          </div>

          <TodayPreview />
        </section>

        <section className="border-t py-16 lg:py-24">
          <h2 className="max-w-2xl text-[clamp(1.75rem,3vw+1rem,2.75rem)] leading-tight font-medium text-balance">
            From a Sunday hello to a midweek phone call
          </h2>
          <ol className="mt-10 divide-y border-y">
            {WEEK.map((step) => (
              <li key={step.when} className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-8">
                <span className="font-heading text-2xl font-medium text-primary">{step.when}</span>
                <p className="max-w-2xl text-lg text-pretty">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid grid-cols-[minmax(0,1fr)] gap-8 pb-16 lg:grid-cols-[1fr_1.2fr] lg:gap-16 lg:pb-24">
          <div>
            <h2 className="text-[clamp(1.75rem,3vw+1rem,2.75rem)] leading-tight font-medium text-balance">
              Gentle with people&apos;s stories
            </h2>
            <p className="mt-4 max-w-md text-lg text-pretty text-muted-foreground">
              Church records are about real lives. GatherFlow keeps them to the people who need them.
            </p>
          </div>
          <ul className="space-y-4 self-end">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex gap-4 text-lg">
                <span aria-hidden className="mt-3 size-2 shrink-0 rounded-full bg-done" />
                {promise}
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-16 rounded-[2rem] bg-warm px-6 py-10 sm:px-10 sm:py-14 lg:mb-24">
          <h2 className="text-[clamp(1.75rem,3vw+1rem,2.75rem)] leading-tight font-medium text-balance">
            Ready for this Sunday?
          </h2>
          <p className="mt-3 max-w-xl text-lg text-pretty">
            Create your church, print your welcome card, and let your team know where to find their
            list.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/sign-up" size="lg" className={PRIMARY}>
              Create your church
            </LinkButton>
            <LinkButton href="/sign-in" variant="ghost" size="lg" className={PRIMARY}>
              I already have an account
            </LinkButton>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            <BrandMark className="size-5" />
            GatherFlow
          </span>
          <span>Church records are sensitive. We built it to treat them that way.</span>
        </div>
      </footer>
    </div>
  );
}
