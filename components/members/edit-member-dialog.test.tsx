import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/tests/factories";
import { changesBetween, EditMemberDialog } from "./edit-member-dialog";

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

const households = [{ id: "h1", name: "Adeyemi household", createdAt: "2024-01-01T00:00:00.000Z" }];

describe("changesBetween (M3)", () => {
  const person = member({ householdId: "h1", email: "grace@example.com" });
  const draft = {
    firstName: "Grace",
    lastName: "Adeyemi",
    preferredName: "",
    phone: person.phone ?? "",
    email: "grace@example.com",
    householdId: "h1",
  };

  it("sends nothing when nothing changed", () => {
    expect(changesBetween(person, draft)).toEqual({});
  });

  it("sends only what changed, trimmed, and null to leave a household", () => {
    expect(changesBetween(person, { ...draft, phone: " 07700 900333 ", householdId: "" })).toEqual({
      phone: "07700 900333",
      householdId: null,
    });
  });
});

describe("EditMemberDialog (M3)", () => {
  it("saves the corrected details and closes", async () => {
    const onSave = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    render(
      <EditMemberDialog person={member()} households={households} onOpenChange={onOpenChange} onSave={onSave} />,
    );

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "07700 900333" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ phone: "07700 900333" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("won't save a blank name and mirrors the server's length limits", () => {
    render(
      <EditMemberDialog person={member()} households={households} onOpenChange={() => {}} onSave={vi.fn()} />,
    );
    expect(screen.getByLabelText("First name")).toHaveAttribute("maxLength", "80");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "  " } });
    expect(screen.getByText("A first and last name are both needed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
