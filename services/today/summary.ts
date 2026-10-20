/**
 * The words at the top of Today: a greeting, and what is waiting said as a
 * sentence rather than as a grid of numbers.
 */
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function count(n: number): string {
  return n < WORDS.length ? WORDS[n] : String(n);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function people(n: number): string {
  return `${count(n)} ${n === 1 ? "person" : "people"}`;
}

export function greeting(fullName: string | undefined, now: Date): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

export function workSentence({ dueToday, overdue }: { dueToday: number; overdue: number }): string {
  if (dueToday === 0 && overdue === 0) return "Nothing is waiting for you today.";
  if (dueToday === 0) return `${capitalise(people(overdue))} still waiting from earlier.`;
  const today = `${capitalise(people(dueToday))} to reach today`;
  return overdue ? `${today}, and ${count(overdue)} still waiting from earlier.` : `${today}.`;
}
