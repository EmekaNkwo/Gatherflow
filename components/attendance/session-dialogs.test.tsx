import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CsvImportDialog, DeleteSessionDialog } from "./session-dialogs";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CsvImportDialog (M9)", () => {
  it("lists the rows that didn't match anyone after importing", async () => {
    const onConfirm = vi.fn().mockResolvedValue({
      matched: 1,
      skipped: 0,
      unmatched: ["Nobody Known", "07000 000000"],
      duplicates: [],
    });
    const onOpenChange = vi.fn();
    render(<CsvImportDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByText("Nobody Known")).toBeInTheDocument());
    expect(screen.getByText("07000 000000")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes straight away when every row matched", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ matched: 2, skipped: 0, unmatched: [], duplicates: [] });
    const onOpenChange = vi.fn();
    render(<CsvImportDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("DeleteSessionDialog (M2)", () => {
  it("explains why a service with people checked in can't be deleted", () => {
    render(
      <DeleteSessionDialog open onOpenChange={vi.fn()} sessionName="Sunday service" sessionDate="2026-10-11" present={1} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/1 person is checked in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete service" })).not.toBeInTheDocument();
  });

  it("deletes an empty service once confirmed", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteSessionDialog open onOpenChange={vi.fn()} sessionName="Year 1900" sessionDate="2026-10-09" present={0} onConfirm={onConfirm} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete service" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
