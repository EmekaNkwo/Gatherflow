import { addDaysIso } from "@/lib/dates";
import { nextReference } from "@/lib/ids";
import type { ContactMethod, IsoDate } from "@/types/common";
import type {
  ClosureReason,
  Household,
  MembershipStatus,
  Person,
  VisitorSource,
} from "@/types/person";
import { at, type SeedContext } from "./context";
import { AREAS, FIRST_NAMES, INTEREST_POOL, LAST_NAMES, PREFERRED_NAMES } from "./names";
import { TEAM_IDS } from "./team";

/** How often a person turns up — drives generated attendance history. */
export type AttendancePattern = "weekly" | "fortnightly" | "monthly" | "lapsed";

export interface VisitorPlan {
  personId: string;
  /** Sundays, oldest first, on which this visitor attended. */
  visitDates: readonly IsoDate[];
  stageId: string;
  assignedTo?: string;
  optedOut: boolean;
  closure?: ClosureReason;
}

export interface SeededPeople {
  people: Person[];
  households: Household[];
  patterns: Map<string, AttendancePattern>;
  visitorPlans: VisitorPlan[];
  /** Members who converted from visitors — used by the journey report. */
  convertedIds: string[];
}

interface VisitorCohort {
  stageId: string;
  weeksAgo: number;
  visits: number;
  assigned: boolean;
  count: number;
  optedOut?: boolean;
  closure?: ClosureReason;
}

/**
 * The visitor pipeline is seeded from explicit cohorts rather than random
 * draws, so every board column, the overdue alerts and the opted-out case
 * are always present in the demo.
 */
const VISITOR_COHORTS: readonly VisitorCohort[] = [
  { stageId: "new_visitor", weeksAgo: 0, visits: 1, assigned: false, count: 3 },
  { stageId: "new_visitor", weeksAgo: 0, visits: 1, assigned: true, count: 2 },
  { stageId: "contact_pending", weeksAgo: 1, visits: 1, assigned: true, count: 4 },
  { stageId: "contact_attempted", weeksAgo: 2, visits: 1, assigned: true, count: 2 },
  { stageId: "contacted", weeksAgo: 2, visits: 1, assigned: true, count: 3 },
  { stageId: "invited_to_return", weeksAgo: 3, visits: 1, assigned: true, count: 2 },
  { stageId: "returned", weeksAgo: 4, visits: 2, assigned: true, count: 3 },
  { stageId: "membership_orientation", weeksAgo: 6, visits: 3, assigned: true, count: 2 },
  {
    stageId: "closed",
    weeksAgo: 5,
    visits: 1,
    assigned: true,
    count: 1,
    optedOut: true,
    closure: "contact_declined",
  },
  {
    stageId: "closed",
    weeksAgo: 7,
    visits: 1,
    assigned: true,
    count: 1,
    closure: "no_response",
  },
];

const SOURCES: readonly VisitorSource[] = [
  "invitation",
  "walk_in",
  "online",
  "social_media",
  "church_event",
  "outreach",
];

const CONTACT_METHOD_MIX: readonly ContactMethod[] = [
  "whatsapp",
  "phone",
  "sms",
  "email",
  "phone",
  "whatsapp",
];

const ASSIGNEES: readonly string[] = [
  TEAM_IDS.volunteerAmara,
  TEAM_IDS.volunteerTunde,
  TEAM_IDS.coordinator,
];

export function createPeople(ctx: SeedContext): SeededPeople {
  const people: Person[] = [];
  const households: Household[] = [];
  const patterns = new Map<string, AttendancePattern>();
  const visitorPlans: VisitorPlan[] = [];
  const convertedIds: string[] = [];
  const usedNames = new Set<string>();
  const references: string[] = [];

  function uniqueName(): { firstName: string; lastName: string } {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const firstName = ctx.pick(FIRST_NAMES);
      const lastName = ctx.pick(LAST_NAMES);
      const key = `${firstName} ${lastName}`;
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return { firstName, lastName };
      }
    }
    const fallback = `${ctx.pick(FIRST_NAMES)} ${ctx.pick(LAST_NAMES)}-${usedNames.size}`;
    const [firstName, lastName] = fallback.split(" ");
    usedNames.add(fallback);
    return { firstName, lastName };
  }

  function phoneFor(index: number): string {
    // Ofcom's reserved "fictitious use" range — never a real number.
    return `+44 7700 900${String(index % 1000).padStart(3, "0")}`;
  }

  function emailFor(firstName: string, lastName: string): string {
    return `${firstName}.${lastName}@example.com`.toLowerCase();
  }

  function interestsFor(): string[] {
    const count = ctx.int(0, 2);
    const chosen = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      chosen.add(ctx.pick(INTEREST_POOL));
    }
    return Array.from(chosen);
  }

  // ---------------------------------------------------------------- members

  const memberStatusPlan: MembershipStatus[] = [
    ...Array.from({ length: 8 }, () => "new_member" as MembershipStatus),
    ...Array.from({ length: 86 }, () => "active" as MembershipStatus),
    ...Array.from({ length: 12 }, () => "inactive" as MembershipStatus),
    "transferred",
    "transferred",
    "transferred",
    "archived",
    "archived",
  ];

  memberStatusPlan.forEach((status, index) => {
    const { firstName, lastName } = uniqueName();
    const id = ctx.id("person");
    const membershipDate =
      status === "new_member"
        ? addDaysIso(ctx.today, -ctx.int(7, 50))
        : addDaysIso(ctx.today, -ctx.int(200, 2200));
    const reference = nextReference("MEM", references);
    references.push(reference);

    const pattern: AttendancePattern =
      status === "inactive" || status === "transferred" || status === "archived"
        ? "lapsed"
        : status === "new_member"
          ? "weekly"
          : ctx.chance(0.55)
            ? "weekly"
            : ctx.chance(0.6)
              ? "fortnightly"
              : "monthly";
    patterns.set(id, pattern);

    const ageGroup = index % 11 === 0 ? "youth" : "adult";

    people.push({
      id,
      kind: "member",
      firstName,
      lastName,
      preferredName: PREFERRED_NAMES[firstName],
      phone: phoneFor(index + 10),
      email: ctx.chance(0.8) ? emailFor(firstName, lastName) : undefined,
      ageGroup,
      interests: interestsFor(),
      groupIds: [],
      contact: {
        preferredMethod: CONTACT_METHOD_MIX[index % CONTACT_METHOD_MIX.length],
        permissionGranted: true,
        optedOut: false,
      },
      member: {
        reference,
        status,
        membershipDate,
        preferredServiceType: ctx.chance(0.75) ? "sunday_service" : "midweek_service",
        statusHistory: [
          {
            status: "new_member",
            changedAt: at(membershipDate, 11),
            changedBy: TEAM_IDS.admin,
            reason: "Membership registered",
          },
          ...(status === "new_member"
            ? []
            : [
                {
                  status,
                  changedAt: at(addDaysIso(membershipDate, 180), 11),
                  changedBy: TEAM_IDS.admin,
                  reason:
                    status === "inactive"
                      ? `No recorded attendance for more than 8 weeks`
                      : status === "transferred"
                        ? "Moved to a partner church"
                        : status === "archived"
                          ? "Record archived at the member's request"
                          : "Settled into church life",
                },
              ]),
        ],
        emergencyContact:
          index % 7 === 0
            ? {
                name: `${ctx.pick(FIRST_NAMES)} ${lastName}`,
                relationship: index % 2 === 0 ? "Spouse" : "Sibling",
                phone: phoneFor(index + 400),
              }
            : undefined,
        requestedContact: index === 3 || index === 17,
      },
      createdAt: at(membershipDate, 11),
      updatedAt: at(ctx.thisWeek, 9),
    });
  });

  // ------------------------------------------- visitors who became members

  const conversionPlan = [
    { firstVisitWeeksAgo: 16, membershipWeeksAgo: 6 },
    { firstVisitWeeksAgo: 14, membershipWeeksAgo: 4 },
    { firstVisitWeeksAgo: 11, membershipWeeksAgo: 3 },
    { firstVisitWeeksAgo: 9, membershipWeeksAgo: 1 },
  ];

  conversionPlan.forEach((plan, index) => {
    const { firstName, lastName } = uniqueName();
    const id = ctx.id("person");
    const firstVisitDate = sundayWeeksAgo(ctx, plan.firstVisitWeeksAgo);
    const membershipDate = sundayWeeksAgo(ctx, plan.membershipWeeksAgo);
    const reference = nextReference("MEM", references);
    references.push(reference);
    patterns.set(id, "weekly");
    convertedIds.push(id);

    const visitDates = [
      firstVisitDate,
      addDaysIso(firstVisitDate, 7),
      addDaysIso(firstVisitDate, 21),
    ];

    people.push({
      id,
      kind: "member",
      firstName,
      lastName,
      preferredName: PREFERRED_NAMES[firstName],
      phone: phoneFor(index + 200),
      email: emailFor(firstName, lastName),
      ageGroup: "adult",
      interests: interestsFor(),
      groupIds: [],
      contact: {
        preferredMethod: index % 2 === 0 ? "whatsapp" : "phone",
        permissionGranted: true,
        optedOut: false,
      },
      visitor: {
        firstVisitDate,
        source: SOURCES[index % SOURCES.length],
        assignedTo: ASSIGNEES[index % ASSIGNEES.length],
        stageId: "connected",
        stageUpdatedAt: at(membershipDate, 12),
        lastContactAt: at(addDaysIso(firstVisitDate, 2), 17),
        contactAttempts: 2,
        membershipInterestAt: at(addDaysIso(firstVisitDate, 21), 12),
        notes: "Joined after attending orientation.",
      },
      member: {
        reference,
        status: plan.membershipWeeksAgo <= 6 ? "new_member" : "active",
        membershipDate,
        preferredServiceType: "sunday_service",
        statusHistory: [
          {
            status: "new_member",
            changedAt: at(membershipDate, 12),
            changedBy: TEAM_IDS.admin,
            reason: "Completed membership orientation",
          },
        ],
        requestedContact: false,
      },
      createdAt: at(firstVisitDate, 12),
      updatedAt: at(membershipDate, 12),
    });

    visitorPlans.push({
      personId: id,
      visitDates,
      stageId: "connected",
      assignedTo: ASSIGNEES[index % ASSIGNEES.length],
      optedOut: false,
    });
  });

  // --------------------------------------------------------------- visitors

  let visitorIndex = 0;
  for (const cohort of VISITOR_COHORTS) {
    for (let seat = 0; seat < cohort.count; seat += 1) {
      const { firstName, lastName } = uniqueName();
      const id = ctx.id("person");
      const firstVisitDate = sundayWeeksAgo(ctx, cohort.weeksAgo);
      const visitDates = Array.from({ length: cohort.visits }, (_, visit) =>
        addDaysIso(firstVisitDate, visit * 7 * (visit === 2 ? 2 : 1)),
      ).filter((date) => date <= ctx.today);
      const assignedTo = cohort.assigned
        ? ASSIGNEES[visitorIndex % ASSIGNEES.length]
        : undefined;
      const optedOut = cohort.optedOut ?? false;
      const contacted = ["contacted", "invited_to_return", "returned", "membership_orientation"].includes(
        cohort.stageId,
      );

      patterns.set(id, "lapsed");

      people.push({
        id,
        kind: "visitor",
        firstName,
        lastName,
        preferredName: PREFERRED_NAMES[firstName],
        phone: phoneFor(visitorIndex + 500),
        email: ctx.chance(0.55) ? emailFor(firstName, lastName) : undefined,
        ageGroup: "adult",
        interests: interestsFor(),
        groupIds: [],
        contact: {
          preferredMethod: CONTACT_METHOD_MIX[visitorIndex % CONTACT_METHOD_MIX.length],
          permissionGranted: !optedOut,
          optedOut,
          optedOutAt: optedOut ? at(addDaysIso(firstVisitDate, 3), 18) : undefined,
          optOutReason: optedOut ? "Asked not to be contacted again." : undefined,
        },
        visitor: {
          firstVisitDate,
          source: SOURCES[visitorIndex % SOURCES.length],
          assignedTo,
          stageId: cohort.stageId,
          stageUpdatedAt: at(addDaysIso(firstVisitDate, cohort.weeksAgo > 0 ? 2 : 0), 14),
          lastContactAt: contacted ? at(addDaysIso(firstVisitDate, 2), 17) : undefined,
          contactAttempts:
            cohort.stageId === "contact_attempted"
              ? 2
              : cohort.closure === "no_response"
                ? 3
                : contacted
                  ? 1
                  : 0,
          membershipInterestAt:
            cohort.stageId === "membership_orientation"
              ? at(addDaysIso(firstVisitDate, 14), 12)
              : undefined,
          closure: cohort.closure
            ? {
                reason: cohort.closure,
                note:
                  cohort.closure === "contact_declined"
                    ? "Asked us not to follow up. Record kept so nobody contacts them again."
                    : "Three attempts made with no response, as agreed with the team.",
                recordedAt: at(addDaysIso(firstVisitDate, 10), 16),
              }
            : undefined,
          notes:
            cohort.stageId === "new_visitor"
              ? "Registered at the welcome desk after the service."
              : undefined,
        },
        createdAt: at(firstVisitDate, 12),
        updatedAt: at(addDaysIso(firstVisitDate, 2), 14),
      });

      visitorPlans.push({
        personId: id,
        visitDates,
        stageId: cohort.stageId,
        assignedTo,
        optedOut,
        closure: cohort.closure,
      });

      visitorIndex += 1;
    }
  }

  // ------------------------------------------------------------- households

  const memberPeople = people.filter((person) => person.kind === "member");
  for (let index = 0; index < 26; index += 1) {
    const head = memberPeople[index * 3];
    if (!head) break;
    const household: Household = {
      id: ctx.id("household"),
      name: `The ${head.lastName} household`,
      area: AREAS[index % AREAS.length],
      primaryContactId: head.id,
      createdAt: head.createdAt,
    };
    households.push(household);

    for (const offset of [0, 1]) {
      const person = memberPeople[index * 3 + offset];
      if (!person) continue;
      const position = people.findIndex((entry) => entry.id === person.id);
      people[position] = { ...people[position], householdId: household.id };
    }
  }

  return { people, households, patterns, visitorPlans, convertedIds };
}

/** The Sunday that fell `weeks` weeks before the current week. */
export function sundayWeeksAgo(ctx: SeedContext, weeks: number): IsoDate {
  // `thisWeek` is a Monday; the Sunday of that week is six days later, which
  // may be in the future, so step back a week when it is.
  const sundayThisWeek = addDaysIso(ctx.thisWeek, 6);
  const candidate = addDaysIso(sundayThisWeek, -7 * weeks);
  return candidate > ctx.today ? addDaysIso(candidate, -7) : candidate;
}
