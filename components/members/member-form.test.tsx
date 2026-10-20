import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/result";
import { freezeTime, resetHarness, seedChurch, transport } from "@/tests/hooks-harness";
import { MemberForm } from "./member-form";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

beforeEach(() => {
  freezeTime();
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
  push.mockReset();
  resetHarness();
});

function fillName(first: string, last: string) {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: first } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: last } });
}

describe("MemberForm", () => {
  it("shows it is adding and sends one request however often it is pressed (H2)", async () => {
    const church = seedChurch();
    let answer: (value: unknown) => void = () => {};
    transport.postCommand.mockImplementation(
      () => new Promise((resolve) => (answer = resolve as (value: unknown) => void)),
    );
    render(<MemberForm />);
    fillName("Zara", "Quentin-Okoro");

    const button = screen.getByRole("button", { name: "Add Zara" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);

    const busy = await screen.findByRole("button", { name: "Adding…" });
    expect(busy).toBeDisabled();
    expect(transport.postCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(ok({ snapshot: church, notices: [], data: { personId: "person_new" } }));
    });
    // Once the server answers, the button is usable again.
    expect(await screen.findByRole("button", { name: "Add Zara" })).toBeEnabled();
  });

  it("limits each field to what the server accepts (L4)", () => {
    seedChurch();
    render(<MemberForm />);
    expect(screen.getByLabelText("First name")).toHaveAttribute("maxLength", "80");
    expect(screen.getByLabelText("Last name")).toHaveAttribute("maxLength", "80");
    expect(screen.getByLabelText("Phone number")).toHaveAttribute("maxLength", "32");
    expect(screen.getByLabelText("Email (optional)")).toHaveAttribute("maxLength", "200");
  });

  it("'That's them' on an existing member opens their member page (M5)", () => {
    const snapshot = seedChurch();
    const existing = snapshot.people.find((person) => person.member && person.phone)!;
    render(<MemberForm />);
    fillName(existing.firstName, existing.lastName);
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: existing.phone } });

    fireEvent.click(screen.getAllByRole("button", { name: "That's them" })[0]);
    expect(push).toHaveBeenCalledWith(`/members/${existing.id}`);
  });
});
