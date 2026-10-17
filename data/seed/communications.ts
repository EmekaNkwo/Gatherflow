import { addDaysIso } from "@/lib/dates";
import type { CommunicationLogEntry, MessageTemplate } from "@/types/communication";
import type { FollowUpTask } from "@/types/follow-up";
import type { Person } from "@/types/person";
import { renderTemplate } from "@/services/communications/template-engine";
import { at, type SeedContext } from "./context";
import { TEAM_IDS } from "./team";

/**
 * Communication history for completed welcome tasks. Every entry is marked
 * as simulated and records what actually happened to the message — drafted,
 * copied, opened externally — never "delivered".
 */
export function createCommunications(
  ctx: SeedContext,
  people: readonly Person[],
  tasks: readonly FollowUpTask[],
  templates: readonly MessageTemplate[],
  churchName: string,
): CommunicationLogEntry[] {
  const welcomeTemplate = templates.find((template) => template.category === "visitor_welcome");
  const byId = new Map(people.map((person) => [person.id, person]));
  const statuses: CommunicationLogEntry["status"][] = [
    "opened_external",
    "copied",
    "opened_external",
    "copied",
  ];

  return tasks
    .filter(
      (task) =>
        task.status === "completed" &&
        task.type === "welcome_message" &&
        task.outcome === "contacted",
    )
    .slice(0, 12)
    .flatMap((task, index) => {
      const person = byId.get(task.personId);
      if (!person || !welcomeTemplate || person.contact.optedOut) return [];

      const sentOn = task.completedAt ? task.completedAt.slice(0, 10) : addDaysIso(ctx.today, -3);
      const rendered = renderTemplate(welcomeTemplate.body, {
        person,
        churchName,
        senderName: "Grace Mensah",
        serviceDate: person.visitor?.firstVisitDate,
        serviceName: "our Sunday service",
      });

      return [
        {
          id: ctx.id("comm"),
          personId: person.id,
          templateId: welcomeTemplate.id,
          taskId: task.id,
          channel: person.contact.preferredMethod,
          status: statuses[index % statuses.length],
          body: rendered.text,
          at: at(sentOn, 16),
          actorId: task.completedBy ?? TEAM_IDS.coordinator,
          simulated: true as const,
        },
      ];
    });
}
