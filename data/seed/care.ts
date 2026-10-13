import { addDaysIso } from "@/lib/dates";
import { nextReference } from "@/lib/ids";
import type { CareCategory, CareRecord, CareStatus } from "@/types/care";
import type { Person } from "@/types/person";
import { at, type SeedContext } from "./context";
import { TEAM_IDS } from "./team";

interface CareDraft {
  category: CareCategory;
  summary: string;
  status: CareStatus;
  receivedOffset: number;
  nextAction?: string;
  nextActionOffset?: number;
  note: string;
  appointmentOffset?: number;
}

/**
 * Pastoral-care seed data. Summaries stay deliberately brief and
 * non-clinical; the detailed notes are marked restricted and never leave
 * the care section.
 */
const DRAFTS: readonly CareDraft[] = [
  {
    category: "hospital_visit",
    summary: "In hospital this week — would appreciate a visit.",
    status: "in_progress",
    receivedOffset: -4,
    nextAction: "Visit on the ward round",
    nextActionOffset: 1,
    note: "Family asked for a short visit only. Keep it brief.",
    appointmentOffset: 1,
  },
  {
    category: "bereavement",
    summary: "Recent family bereavement; asked for support.",
    status: "assigned",
    receivedOffset: -9,
    nextAction: "Phone call with the family",
    nextActionOffset: 2,
    note: "Prefers a call in the evening. Funeral arrangements being made.",
  },
  {
    category: "practical_support",
    summary: "Needs help with transport to Sunday services.",
    status: "new",
    receivedOffset: -1,
    nextAction: "Match with someone on the same route",
    nextActionOffset: 3,
    note: "Lives near Riverside; two group members drive past.",
  },
  {
    category: "new_parent",
    summary: "New baby — meals rota offered.",
    status: "awaiting_response",
    receivedOffset: -16,
    nextAction: "Confirm whether the rota is still wanted",
    nextActionOffset: -2,
    note: "Rota offered two weeks ago, no reply yet. Do not chase more than once.",
  },
  {
    category: "prayer_request",
    summary: "Ongoing prayer request for work situation.",
    status: "resolved",
    receivedOffset: -30,
    note: "Situation resolved; they asked us to stop the weekly check-ins.",
  },
];

export function createCareRecords(
  ctx: SeedContext,
  people: readonly Person[],
): CareRecord[] {
  const candidates = people.filter((person) => person.kind === "member").slice(4, 20);
  const references: string[] = [];

  return DRAFTS.map((draft, index) => {
    const person = candidates[index * 2] ?? candidates[index];
    const reference = nextReference("CARE", references, 3);
    references.push(reference);
    const receivedAt = addDaysIso(ctx.today, draft.receivedOffset);

    return {
      id: ctx.id("care"),
      reference,
      personId: person.id,
      category: draft.category,
      summary: draft.summary,
      assigneeId: draft.status === "new" ? undefined : TEAM_IDS.careLead,
      receivedAt,
      nextAction: draft.nextAction,
      nextActionDate:
        draft.nextActionOffset === undefined
          ? undefined
          : addDaysIso(ctx.today, draft.nextActionOffset),
      status: draft.status,
      notes: [
        {
          at: at(receivedAt, 15),
          by: TEAM_IDS.careLead,
          text: draft.note,
          visibility: "restricted" as const,
        },
      ],
      appointments:
        draft.appointmentOffset === undefined
          ? []
          : [
              {
                id: ctx.id("appointment"),
                date: addDaysIso(ctx.today, draft.appointmentOffset),
                time: "15:00",
                location: "Hospital — ward reception",
                status: "scheduled" as const,
              },
            ],
      createdAt: at(receivedAt, 15),
      updatedAt: at(receivedAt, 15),
    } satisfies CareRecord;
  });
}
