import type { ContactMethod } from "@/types/common";
import type { MessageTemplate, TemplateCategory } from "@/types/communication";
import type { FollowUpTaskType } from "@/types/follow-up";

/** The wording that fits each kind of follow-up best. */
const CATEGORY_FOR_TASK: Partial<Record<FollowUpTaskType, TemplateCategory>> = {
  welcome_message: "visitor_welcome",
  service_invitation: "service_invitation",
  group_invitation: "group_invitation",
  membership_orientation: "membership_orientation",
  post_event_follow_up: "post_event",
};

/**
 * The template the composer opens with.
 *
 * Alphabetical order used to win, which put "Connect-group invitation" first
 * — a template that always has a gap to fill. Now the task decides the
 * wording when there is one (a welcome for a first visit, otherwise a general
 * check-in), and among those a template that suits how the person likes to be
 * contacted comes first.
 */
export function chooseTemplate(
  templates: readonly MessageTemplate[],
  options: { preferredMethod: ContactMethod; taskType?: FollowUpTaskType; isVisitor?: boolean },
): MessageTemplate | undefined {
  const category: TemplateCategory =
    (options.taskType && CATEGORY_FOR_TASK[options.taskType]) ??
    (options.taskType === undefined && options.isVisitor ? "visitor_welcome" : "general_check_in");
  const suits = (template: MessageTemplate) => template.channels.includes(options.preferredMethod);

  const sameCategory = templates.filter((template) => template.category === category);
  return (
    sameCategory.find(suits) ??
    sameCategory[0] ??
    templates.find((template) => suits(template) && template.category !== "group_invitation") ??
    templates.find(suits) ??
    templates[0]
  );
}

/**
 * The channel to use with a template: the person's preference when the
 * template offers it, otherwise the template's first channel. Never a channel
 * the template doesn't list.
 */
export function channelFor(
  template: Pick<MessageTemplate, "channels"> | undefined,
  preferred: ContactMethod,
  current?: ContactMethod,
): ContactMethod {
  if (!template?.channels.length) return current ?? preferred;
  if (current && template.channels.includes(current)) return current;
  return template.channels.includes(preferred) ? preferred : template.channels[0];
}
