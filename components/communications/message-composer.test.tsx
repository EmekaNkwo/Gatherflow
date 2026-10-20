import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import {
  acceptCommands,
  freezeTime,
  lastCommand,
  resetHarness,
  seedChurch,
  transport,
} from "@/tests/hooks-harness";
import type { Person } from "@/types/person";
import { MessageComposer } from "./message-composer";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const writeText = vi.fn<(text: string) => Promise<void>>();

function reachable(): Person {
  const snapshot = seedChurch({ role: "follow_up_coordinator", teamMemberId: TEAM_IDS.coordinator });
  const person = snapshot.people.find(
    (entry) => entry.contact.permissionGranted && !entry.contact.optedOut && entry.phone,
  );
  if (!person) throw new Error("The seed has nobody who can be contacted.");
  return person;
}

beforeEach(() => {
  freezeTime();
  // The dialog picks a sheet or a centred dialog by screen width.
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
  );
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetHarness();
});

describe("MessageComposer", () => {
  it("doesn't open on a template that always has a gap", () => {
    const person = reachable();
    render(<MessageComposer person={person} onOpenChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "What to say" })).not.toHaveTextContent("Connect-group invitation");
  });

  it("blocks every way of sending while a gap remains", () => {
    const person = reachable();
    render(<MessageComposer person={person} onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Our {{groupName}} meets weekly" } });

    expect(screen.getByText(/still needs replacing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeDisabled();
    const open = screen.queryByRole("button", { name: /Open in app/ });
    if (open) expect(open).toBeDisabled();
  });

  it("records the edited words first, then copies them and closes", async () => {
    const person = reachable();
    acceptCommands();
    const onOpenChange = vi.fn();
    render(<MessageComposer person={person} onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "See you Sunday" } });
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(transport.postCommand).toHaveBeenCalledTimes(1);
    expect(lastCommand()).toMatchObject({ name: "communication.log", input: { status: "copied", body: "See you Sunday" } });
    expect(writeText).toHaveBeenCalledWith("See you Sunday");
  });
});
