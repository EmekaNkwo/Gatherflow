import { toast } from "sonner";

/**
 * The error toast for a form on the public pages (sign-in, sign-up, password
 * reset, invitations, the welcome page). One id, so a second failed attempt
 * replaces the first toast instead of stacking another on top of it.
 */
export const FORM_ERROR_TOAST = "form-error";

function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The title, then the server's words, then what to do next. */
export function showFormError(title: string, message: string, hint?: string): void {
  const description = hint ? `${asSentence(message)} ${hint}` : asSentence(message);
  toast.error(title, { id: FORM_ERROR_TOAST, description });
}
