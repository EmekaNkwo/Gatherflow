import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCsv, downloadJson, parseCsv, parseCsvRecords, toCsv, type CsvColumn } from "./csv";

interface Row {
  name: string;
  note?: string;
  count?: number;
}

const columns: CsvColumn<Row>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "Note", value: (row) => row.note },
  { header: "Count", value: (row) => row.count },
];

describe("toCsv", () => {
  it("writes a header row and CRLF-separated body rows", () => {
    expect(toCsv([{ name: "Ada", note: "hi", count: 3 }], columns)).toBe("Name,Note,Count\r\nAda,hi,3");
  });

  it("writes only the header when there are no rows", () => {
    expect(toCsv([], columns)).toBe("Name,Note,Count");
  });

  it.each<[string, Row, string]>([
    ["undefined cells as empty", { name: "Ada" }, "Ada,,"],
    ["zero as a number, not empty", { name: "Ada", count: 0 }, "Ada,,0"],
    ["commas by quoting", { name: "Smith, John" }, '"Smith, John",,'],
    ["quotes by doubling them", { name: 'Ada "Al"' }, '"Ada ""Al""",,'],
    ["newlines by quoting", { name: "line1\nline2" }, '"line1\nline2",,'],
  ])("escapes %s", (_label, row, expectedBody) => {
    expect(toCsv([row], columns).split("\r\n")[1]).toBe(expectedBody);
  });

  it("escapes headers too", () => {
    expect(toCsv([], [{ header: "a,b", value: () => "" }])).toBe('"a,b"');
  });

  it("round-trips through parseCsv", () => {
    const rows: Row[] = [
      { name: 'O"Brien, Pat', note: "two\nlines", count: 12 },
      { name: "Plain", count: 1 },
    ];
    expect(parseCsv(toCsv(rows, columns))).toEqual([
      ["Name", "Note", "Count"],
      ['O"Brien, Pat', "two\nlines", "12"],
      ["Plain", "", "1"],
    ]);
  });
});

describe("parseCsv", () => {
  it.each<[string, string, string[][]]>([
    ["empty input", "", []],
    ["a single cell", "a", [["a"]]],
    ["LF line endings", "a,b\nc,d", [["a", "b"], ["c", "d"]]],
    ["CRLF line endings", "a,b\r\nc,d\r\n", [["a", "b"], ["c", "d"]]],
    ["a trailing comma as an empty last cell", "a,b,\n", [["a", "b", ""]]],
    ["quoted commas", '"a,b",c', [["a,b", "c"]]],
    ["escaped quotes", '"say ""hi""",x', [['say "hi"', "x"]]],
    ["newlines inside quotes", '"one\ntwo",3', [["one\ntwo", "3"]]],
    ["CR inside quotes kept", '"one\r\ntwo"', [["one\r\ntwo"]]],
    ["blank and whitespace-only rows dropped", "a\n\n , \nb\n", [["a"], ["b"]]],
    ["rows of differing length", "a,b,c\nd", [["a", "b", "c"], ["d"]]],
    ["an unterminated quote swallowing the rest", '"open,still\nopen', [["open,still\nopen"]]],
    ["a leading BOM kept in the first cell", "﻿name\nAda", [["﻿name"], ["Ada"]]],
  ])("parses %s", (_label, input, expected) => {
    expect(parseCsv(input)).toEqual(expected);
  });
});

describe("parseCsvRecords", () => {
  it("returns nothing for empty input", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });

  it("returns nothing for a header with no body", () => {
    expect(parseCsvRecords("First Name,Email")).toEqual([]);
  });

  it("keys records by trimmed, lower-cased headers and trims values", () => {
    expect(parseCsvRecords(" First Name ,EMAIL\r\n  Ada , ada@example.org \r\nBo,bo@example.org")).toEqual([
      { "first name": "Ada", email: "ada@example.org" },
      { "first name": "Bo", email: "bo@example.org" },
    ]);
  });

  it("fills missing trailing cells with empty strings and ignores extra cells", () => {
    expect(parseCsvRecords("a,b\n1\n2,3,4")).toEqual([
      { a: "1", b: "" },
      { a: "2", b: "3" },
    ]);
  });

  it("strips a spreadsheet BOM from the first header", () => {
    expect(parseCsvRecords("﻿Name,Phone\nAda,0123")).toEqual([{ name: "Ada", phone: "0123" }]);
  });
});

describe("downloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubDownload() {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:test-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function noop() {});
    return { createObjectURL, revokeObjectURL, click };
  }

  it("downloadCsv prefixes a BOM, names the file and revokes the URL", async () => {
    const { createObjectURL, revokeObjectURL, click } = stubDownload();

    downloadCsv("people.csv", "a,b");

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("a,b");
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("people.csv");
    expect(anchor.href).toBe("blob:test-url");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("downloadJson pretty-prints the data as application/json", async () => {
    const { createObjectURL, revokeObjectURL, click } = stubDownload();

    downloadJson("backup.json", { a: [1] });

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("backup.json");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("both are no-ops without a window", () => {
    const { createObjectURL } = stubDownload();
    vi.stubGlobal("window", undefined);
    try {
      downloadCsv("x.csv", "a");
      downloadJson("x.json", {});
    } finally {
      vi.unstubAllGlobals();
    }
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
