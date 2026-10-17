"use client";

import type { ReactNode } from "react";
import { EllipsisIcon, MailIcon, MessageCircleIcon, MessageSquareIcon, PhoneIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { displayName } from "@/lib/strings";
import { contactOptions, type ContactLink } from "@/services/follow-ups/contact";
import type { Person } from "@/types/person";

const CONTACT_ICONS = {
  phone: PhoneIcon,
  sms: MessageSquareIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
  in_person: PhoneIcon,
} as const;

/** A quiet chip; `tone` picks the colour from the design tokens. */
export function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "done" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium",
        tone === "muted" && "bg-background/70 text-muted-foreground",
        tone === "accent" && "bg-primary/12 text-primary dark:text-foreground",
        tone === "done" && "bg-done/15 text-done dark:text-foreground",
        tone === "warning" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

export interface PersonMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface PersonHeroProps {
  person: Person;
  /** A short line above the name, e.g. "Visitor · first came 12 Oct". */
  eyebrow: ReactNode;
  /** One or two sentences about where they are. */
  summary?: ReactNode;
  chips?: ReactNode;
  /** Offered beside the one-tap contact links, only when allowed. */
  onMessage?: () => void;
  /** Rarer actions, behind "More". Destructive ones go last. */
  menu?: readonly PersonMenuItem[];
  /** Small print under everything, e.g. a record number. */
  footnote?: ReactNode;
  children?: ReactNode;
}

/**
 * Who this is and how to reach them, at a glance. Contact links come from
 * `contactOptions`, so nothing is offered to somebody who opted out or never
 * agreed; the reason is said instead.
 */
export function PersonHero({
  person,
  eyebrow,
  summary,
  chips,
  onMessage,
  menu,
  footnote,
  children,
}: PersonHeroProps) {
  const name = displayName(person);
  const contact = contactOptions(person);
  const safe = menu?.filter((item) => !item.destructive) ?? [];
  const destructive = menu?.filter((item) => item.destructive) ?? [];

  return (
    <section className="space-y-5 rounded-[2rem] bg-warm px-6 py-7 md:px-10 md:py-10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
          <h1 className="font-heading text-4xl leading-tight font-medium break-words md:text-5xl">{name}</h1>
        </div>
        {menu && menu.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-lg"
                  variant="ghost"
                  className="-mr-2 shrink-0 rounded-full"
                  aria-label={`More for ${name}`}
                >
                  <EllipsisIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-56">
              {safe.map((item) => (
                <DropdownMenuItem key={item.label} className="min-h-11" onClick={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
              {safe.length && destructive.length ? <DropdownMenuSeparator /> : null}
              {destructive.map((item) => (
                <DropdownMenuItem key={item.label} className="min-h-11" variant="destructive" onClick={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {summary ? <p className="max-w-xl text-lg">{summary}</p> : null}
      {chips ? <div className="flex flex-wrap gap-2">{chips}</div> : null}

      {contact.kind === "ok" || onMessage ? (
        <div className="flex flex-wrap gap-2">
          {contact.kind === "ok"
            ? contact.links.map((link) => <ContactLinkButton key={link.method} link={link} name={name} />)
            : null}
          {onMessage ? (
            <Button
              variant="outline"
              size="lg"
              className="rounded-full bg-background"
              onClick={onMessage}
              aria-label={`Write a message to ${name}`}
            >
              <MessageSquareIcon />
              Write a message
            </Button>
          ) : null}
        </div>
      ) : null}
      {contact.kind !== "ok" ? <p className="text-muted-foreground">{contact.reason}.</p> : null}

      {children}
      {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}

function ContactLinkButton({ link, name }: { link: ContactLink; name: string }) {
  const Icon = CONTACT_ICONS[link.method];
  const external = link.href.startsWith("http");
  return (
    <a
      href={link.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      aria-label={`${link.label} ${name}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-background px-5 text-base font-medium hover:bg-muted"
    >
      <Icon className="size-4" />
      {link.label}
    </a>
  );
}
