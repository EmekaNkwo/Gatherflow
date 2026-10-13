import type { MessageTemplate } from "@/types/communication";
import { at, type SeedContext } from "./context";

/**
 * Built-in message templates. Wording is deliberately warm but low-pressure:
 * a first-time visitor should feel welcomed, not pursued.
 */
export function createTemplates(ctx: SeedContext): MessageTemplate[] {
  const timestamp = at(ctx.thisWeek, 9);

  const templates: Array<Omit<MessageTemplate, "id" | "createdAt" | "updatedAt">> = [
    {
      name: "First-time visitor welcome",
      category: "visitor_welcome",
      channels: ["whatsapp", "sms", "email"],
      body:
        "Hello {{firstName}}, thank you for worshipping with us at {{churchName}} on {{serviceDate}}. " +
        "We were glad to have you and hope you felt welcome. If there's anything you'd like to know " +
        "about the church, just reply to this message.\n\n{{senderName}}",
      builtIn: true,
    },
    {
      name: "Thank you for attending",
      category: "thank_you",
      channels: ["sms", "whatsapp", "email"],
      body:
        "Hi {{firstName}}, it was good to see you at {{serviceName}}. Thank you for joining us. " +
        "You're welcome any time.\n\n{{senderName}}, {{churchName}}",
      builtIn: true,
    },
    {
      name: "Invitation to a service",
      category: "service_invitation",
      channels: ["sms", "whatsapp", "phone"],
      body:
        "Hello {{firstName}}, we're meeting again on {{serviceDate}} for {{serviceName}}. " +
        "It would be lovely to see you, but no pressure at all.\n\n{{senderName}}",
      builtIn: true,
    },
    {
      name: "Follow-up after an event",
      category: "post_event",
      channels: ["whatsapp", "email"],
      body:
        "Hi {{firstName}}, thank you for coming to {{serviceName}}. We hope you enjoyed it. " +
        "If you'd like to hear about what's coming up at {{churchName}}, let me know.\n\n{{senderName}}",
      builtIn: true,
    },
    {
      name: "Membership orientation invitation",
      category: "membership_orientation",
      channels: ["email", "whatsapp", "phone"],
      body:
        "Hello {{firstName}}, you asked about becoming a member at {{churchName}}. " +
        "Our next orientation session is on {{serviceDate}} and takes about an hour. " +
        "Would you like me to save you a place?\n\n{{senderName}}",
      builtIn: true,
    },
    {
      name: "Connect-group invitation",
      category: "group_invitation",
      channels: ["whatsapp", "sms"],
      body:
        "Hi {{firstName}}, our {{groupName}} meets weekly and is a good place to get to know people. " +
        "You'd be very welcome to come along and see what it's like.\n\n{{senderName}}",
      builtIn: true,
    },
    {
      name: "General check-in",
      category: "general_check_in",
      channels: ["phone", "whatsapp", "sms"],
      body:
        "Hello {{firstName}}, just checking in from {{churchName}} to see how you're doing. " +
        "No need to reply if now isn't a good time.\n\n{{senderName}}",
      builtIn: true,
    },
  ];

  return templates.map((template) => ({
    ...template,
    id: ctx.id("template"),
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}
