/**
 * Why a custom report range can't be used yet, or `null` when it can.
 *
 * An empty date box would otherwise silently mean "all time" (an empty
 * start) or "nothing" (an empty end), and a back-to-front range reads as
 * "nobody visited". The report keeps the last good range instead.
 */
export function customRangeProblem(from: string, to: string): string | null {
  if (!from || !to) return "Choose both a start and an end date.";
  if (from > to) return "The start date is after the end date.";
  return null;
}
