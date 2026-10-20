import { z } from "zod";
import { CONTACT_METHODS } from "@/types/common";
import { VISITOR_SOURCES } from "@/types/person";

/**
 * Form validation for visitor registration.
 *
 * Only a name and a visit date are required: nobody should have to hand
 * over a phone number to be welcomed. Contact permission is opt-in and
 * defaults to false.
 */
/**
 * Limits shared with the server's command schemas, so a form never lets
 * through something the server then refuses with a less friendly message.
 */
export const VISITOR_FIELD_LIMITS = {
  name: 80,
  preferredName: 40,
  phone: 32,
  email: 200,
  notes: 500,
} as const;

const firstName = (message: string) =>
  z.string().trim().min(1, message).max(VISITOR_FIELD_LIMITS.name, "Keep the first name to 80 characters.");
const lastName = (message: string) =>
  z.string().trim().min(1, message).max(VISITOR_FIELD_LIMITS.name, "Keep the last name to 80 characters.");

const email = z
  .string()
  .trim()
  .max(VISITOR_FIELD_LIMITS.email, "That email address looks too long.")
  .refine((value) => value === "" || z.string().email().safeParse(value).success, {
    message: "That email address does not look right.",
  });

const phone = z
  .string()
  .trim()
  .max(VISITOR_FIELD_LIMITS.phone, "That phone number looks too long.")
  .refine((value) => value === "" || /^[\d\s+()-]{6,}$/.test(value), {
    message: "Use digits, spaces and + ( ) - only.",
  });

export const visitorRegistrationSchema = z
  .object({
    firstName: firstName("A first name is needed."),
    lastName: lastName("A last name is needed."),
    preferredName: z
      .string()
      .trim()
      .max(VISITOR_FIELD_LIMITS.preferredName, "Keep the preferred name to 40 characters.")
      .optional(),
    phone: phone.optional(),
    email: email.optional(),
    visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of the visit."),
    sessionId: z.string().optional(),
    source: z.enum(VISITOR_SOURCES),
    assignedTo: z.string().optional(),
    preferredMethod: z.enum(CONTACT_METHODS),
    permissionGranted: z.boolean(),
    interests: z.array(z.string()).default([]),
    notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
    returningVisitor: z.boolean().default(false),
  })
  .refine(
    (value) =>
      // A contact method is only meaningful if we can reach them that way.
      !value.permissionGranted ||
      value.preferredMethod === "in_person" ||
      Boolean(value.phone?.trim()) ||
      Boolean(value.email?.trim()),
    {
      message: "Add a phone number or email, or choose 'in person' as the contact method.",
      path: ["preferredMethod"],
    },
  );

export type VisitorRegistrationValues = z.input<typeof visitorRegistrationSchema>;

/** The shorter form used on the public welcome page. */
export const selfRegistrationSchema = z.object({
  firstName: firstName("Please tell us your first name."),
  lastName: lastName("Please tell us your last name."),
  phone: phone.optional(),
  email: email.optional(),
  firstVisit: z.boolean().default(true),
  preferredMethod: z.enum(CONTACT_METHODS),
  permissionGranted: z.boolean(),
});

export type SelfRegistrationValues = z.input<typeof selfRegistrationSchema>;

/** Quick registration: the smallest form that still creates a usable record. */
export const quickRegistrationSchema = z.object({
  firstName: firstName("A first name is needed."),
  lastName: lastName("A last name is needed."),
  phone: phone.optional(),
  source: z.enum(VISITOR_SOURCES),
  preferredMethod: z.enum(CONTACT_METHODS),
  permissionGranted: z.boolean(),
  assignedTo: z.string().optional(),
});

export type QuickRegistrationValues = z.input<typeof quickRegistrationSchema>;
