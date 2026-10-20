/**
 * Dialable phone numbers.
 *
 * `normalisePhone` in `lib/strings.ts` keeps only the last nine digits, which
 * is right for spotting duplicates and wrong for anything that dials: a
 * WhatsApp link built from it reaches a number that doesn't exist, or a
 * stranger. This module keeps the whole number instead.
 */

/** Calling code assumed for numbers typed in local form, e.g. `07700 900506`. */
export const DEFAULT_COUNTRY_CALLING_CODE = "44";

/** E.164 allows at most 15 digits; anything under 8 cannot be a real number. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** A calling code is one to three digits and never starts with 0. */
export function isCallingCode(value: string): boolean {
  return /^[1-9]\d{0,2}$/.test(value);
}

/**
 * The full international number as digits only (E.164 without the `+`), or
 * `undefined` when the text can't honestly be read as a phone number.
 *
 * - `+44 7700 900506` and `0044 7700 900506` keep their country code.
 * - `07700 900506` is local: the leading 0 is swapped for the church's code.
 * - `+44 (0)7700 900506`, a common British habit, drops the `(0)`.
 * - Bare digits are read as international when they already start with the
 *   church's code and are long enough (`447700900506`), else as local.
 * - Letters, or too few or too many digits, give `undefined` so no link is
 *   offered rather than a wrong one.
 */
export function toInternational(
  phone: string | undefined,
  defaultCountryCallingCode: string = DEFAULT_COUNTRY_CALLING_CODE,
): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.trim().replace(/\(0\)/g, "");
  if (!cleaned || /[^\d\s+().\-/]/.test(cleaned)) return undefined;
  // A plus is only meaningful at the very start.
  if (cleaned.lastIndexOf("+") > 0) return undefined;

  const digits = cleaned.replace(/\D/g, "");
  const code = isCallingCode(defaultCountryCallingCode)
    ? defaultCountryCallingCode
    : DEFAULT_COUNTRY_CALLING_CODE;

  const international = cleaned.startsWith("+")
    ? digits
    : digits.startsWith("00")
      ? digits.slice(2)
      : digits.startsWith("0")
        ? `${code}${digits.slice(1)}`
        : // Long enough to already carry the code, e.g. `447700900506`.
          digits.startsWith(code) && digits.length >= 11
          ? digits
          : `${code}${digits}`;

  if (international.startsWith("0")) return undefined;
  if (international.length < MIN_DIGITS || international.length > MAX_DIGITS) return undefined;
  return international;
}
