import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "cn";
import { displayName, fullName, initials } from "@/lib/strings";
import type { Person } from "@/types/person";
import { OptedOutBadge } from "./badges";

interface PersonCellProps {
  person: Person;
  /** Extra line under the name, e.g. the member reference or last visit. */
  subtitle?: string;
  href?: string;
  className?: string;
  showOptOut?: boolean;
}

/** Person identity cell: avatar, preferred name and the consent warning. */
export function PersonCell({
  person,
  subtitle,
  href,
  className,
  showOptOut = true,
}: PersonCellProps) {
  const name = displayName(person);
  const legal = fullName(person);

  const body = (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-xs">{initials(person)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{name}</span>
          {showOptOut && person.contact.optedOut ? <OptedOutBadge /> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {subtitle ?? (name === legal ? (person.phone ?? person.email ?? "No contact details") : legal)}
        </p>
      </div>
    </div>
  );

  if (!href) return <div className={cn("py-0.5", className)}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-md py-0.5 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {body}
    </Link>
  );
}

/** Where a person's profile lives, depending on what they are now. */
export function personHref(person: Person): string {
  return person.member ? `/members/${person.id}` : `/visitors/${person.id}`;
}
