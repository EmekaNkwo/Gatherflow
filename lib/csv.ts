/**
 * CSV helpers for the demo exports and the mock attendance import.
 * Private notes are never passed in here — exports are assembled from an
 * explicit column list in the calling service.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | undefined;
}

function escapeCell(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(","),
  );
  return [header, ...body].join("\r\n");
}

/** Minimal RFC-4180-ish parser: quoted cells, escaped quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim().length));
}

/** Parses a CSV with a header row into keyed records. */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  if (!rows.length) return [];
  const [header, ...body] = rows;
  const keys = header.map((value) => value.trim().toLowerCase());
  return body.map((cells) =>
    keys.reduce<Record<string, string>>((acc, key, index) => {
      acc[key] = (cells[index] ?? "").trim();
      return acc;
    }, {}),
  );
}

/** Triggers a client-side download; no-ops outside the browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
