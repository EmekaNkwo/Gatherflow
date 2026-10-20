import { formatDisplayDate } from "@/lib/dates";
import { parseCsvRecords } from "@/lib/csv";
import { err, ok, type Result } from "@/lib/result";
import { displayName, normalise, normalisePhone } from "@/lib/strings";
import type { SessionId } from "@/types/common";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult, type DomainEvent } from "../core/events";
import { recordAttendance } from "./check-in";

export interface CsvImportSummary {
  matched: number;
  skipped: number;
  /** Rows that could not be matched to a person in the directory. */
  unmatched: string[];
  duplicates: string[];
}

/** Header names we understand, after lower-casing and tidying. */
const NAME_HEADERS = ["name", "full name"];
const FIRST_NAME_HEADERS = ["first name", "firstname", "given name"];
const LAST_NAME_HEADERS = ["last name", "lastname", "surname", "family name"];
const PHONE_HEADERS = ["phone", "mobile", "phone number", "mobile number"];

function tidyHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function quoteCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Spreadsheets saved in much of Europe separate columns with `;`, and a copy
 * from a table pastes with tabs. Either is turned into commas before parsing,
 * judged from the header line.
 */
export function normaliseDelimiter(csv: string): string {
  const header = csv.split(/\r?\n/, 1)[0] ?? "";
  if (header.includes(",")) return csv;
  const delimiter = header.includes(";") ? ";" : header.includes("\t") ? "\t" : null;
  if (!delimiter) return csv;
  return csv
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => quoteCell(cell)).join(","))
    .join("\n");
}

function pick(row: Record<string, string>, names: readonly string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value) return value;
  }
  return "";
}

function hasAny(headers: readonly string[], names: readonly string[]): boolean {
  return names.some((name) => headers.includes(name));
}

/**
 * Imports an attendance list with a `name` (or first and last name) and an
 * optional `phone` column. Unmatched rows are reported rather than guessed
 * at, and no new people are created by an import.
 *
 * Every matched row is an ordinary check-in, so its events — a visitor
 * coming back, for instance — go to the automations just as a tap at the
 * door would.
 */
export function importAttendanceCsv(
  snapshot: ChurchSnapshot,
  sessionId: SessionId,
  csv: string,
  ctx: CommandContext,
): Result<CommandResult & { summary: CsvImportSummary }> {
  const session = snapshot.sessions.find((entry) => entry.id === sessionId);
  if (!session) return err("That session no longer exists.", "not_found");
  if (session.date > ctx.today) {
    return err(
      `${session.name} on ${formatDisplayDate(session.date)} hasn't happened yet. Import the list after the service.`,
      "invalid",
    );
  }

  const parsed = parseCsvRecords(normaliseDelimiter(csv));
  if (!parsed.length) return err("That file has no rows to import.", "invalid");

  const rows = parsed.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [tidyHeader(key), value])),
  );
  const headers = Object.keys(rows[0]);
  const hasName =
    hasAny(headers, NAME_HEADERS) ||
    (hasAny(headers, FIRST_NAME_HEADERS) && hasAny(headers, LAST_NAME_HEADERS));
  if (!hasName && !hasAny(headers, PHONE_HEADERS)) {
    return err(
      "No name column found. The first line should name the columns, for example: name,phone",
      "invalid",
    );
  }

  const summary: CsvImportSummary = { matched: 0, skipped: 0, unmatched: [], duplicates: [] };
  const events: DomainEvent[] = [];
  const notices: string[] = [];
  let current = snapshot;

  for (const row of rows) {
    const name =
      pick(row, NAME_HEADERS) ||
      `${pick(row, FIRST_NAME_HEADERS)} ${pick(row, LAST_NAME_HEADERS)}`.trim();
    const phone = normalisePhone(pick(row, PHONE_HEADERS));
    const needle = normalise(name);

    const person = current.people.find((candidate) => {
      if (phone && normalisePhone(candidate.phone) === phone) return true;
      return Boolean(needle) && normalise(`${candidate.firstName} ${candidate.lastName}`) === needle;
    });

    if (!person) {
      summary.unmatched.push(name || pick(row, PHONE_HEADERS) || "(blank row)");
      continue;
    }

    const outcome = recordAttendance(
      current,
      { sessionId, personId: person.id, method: "csv_import" },
      ctx,
    );

    if (outcome.ok) {
      current = outcome.value.snapshot;
      summary.matched += 1;
      events.push(...outcome.value.events);
      // Only what the check-in learned beyond "checked in", which the totals cover.
      notices.push(...outcome.value.notices.slice(1));
    } else {
      summary.skipped += 1;
      if (outcome.code === "duplicate") summary.duplicates.push(displayName(person));
    }
  }

  return ok({
    ...result(current, events, [
      `${summary.matched} attendance record${summary.matched === 1 ? "" : "s"} imported.`,
      ...(summary.duplicates.length
        ? [`${summary.duplicates.length} already checked in.`]
        : []),
      ...(summary.unmatched.length
        ? [`${summary.unmatched.length} row${summary.unmatched.length === 1 ? "" : "s"} did not match anyone.`]
        : []),
      ...notices,
    ]),
    summary,
  });
}
