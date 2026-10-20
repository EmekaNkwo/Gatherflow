/**
 * Input limits for member forms. They mirror the server's schema for
 * `member.register` and `person.correct` (services/commands/registry.ts), so
 * a field can't be typed longer than the server will accept.
 */
export const MEMBER_FIELD_LIMITS = {
  name: 80,
  preferredName: 40,
  phone: 32,
  email: 200,
  reason: 500,
} as const;
