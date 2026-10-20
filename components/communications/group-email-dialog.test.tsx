import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { acceptCommands, freezeTime, lastCommand, resetHarness, seedChurch, seedSnapshot } from "@/tests/hooks-harness";
import type { Person } from "@/types/person";
import { GroupEmailDialog } from "./group-email-dialog";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const assign = vi.fn<(url: string) => void>();
const realLocation = window.location;

/** Two people who can be emailed, and one who opted out. */
function church(
  change: (snapshot: ReturnType<typeof seedSnapshot>) => ReturnType<typeof seedSnapshot> = (snapshot) => snapshot,
): { amara: Person; tobi: Person; reuben: Person } {
  const snapshot = seedSnapshot();
  const [first, second, third] = snapshot.people.filter((person) => person.visitor);
  const reachable = { preferredMethod: "email" as const, permissionGranted: true, optedOut: false };
  const amara = { ...first, firstName: "Amara", preferredName: undefined, email: "amara@example.com", contact: reachable };
  // Same first Sunday, so one shared email can still say which service.
  const tobi = {
    ...second,
    firstName: "Tobi",
    preferredName: undefined,
    email: "tobi@example.com",
    contact: reachable,
    visitor: second.visitor && first.visitor ? { ...second.visitor, firstVisitDate: first.visitor.firstVisitDate } : second.visitor,
  };
  const reuben = {
    ...third,
    firstName: "Reuben",
    lastName: "Zulu",
    preferredName: undefined,
    email: "reuben@example.com",
    contact: { ...reachable, optedOut: true },
  };
  const replaced = new Map([amara, tobi, reuben].map((person) => [person.id, person]));
  seedChurch({
    role: "administrator",
    teamMemberId: TEAM_IDS.admin,
    snapshot: change({ ...snapshot, people: snapshot.people.map((person) => replaced.get(person.id) ?? person) }),
  });
  return { amara, tobi, reuben };
}

beforeEach(() => {
  freezeTime();
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
  );
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
  assign.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
  resetHarness();
});

describe("GroupEmailDialog", () => {
  it("names who is left out and why", () => {
    const { amara, tobi, reuben } = church();
    render(<GroupEmailDialog personIds={[amara.id, tobi.id, reuben.id]} onOpenChange={() => {}} />);

    expect(screen.getByText(/Reuben Zulu \(asked not to be contacted\)/)).toBeInTheDocument();
  });

  it("writes each person their own email and records it once they say it went", async () => {
    const { amara, tobi } = church();
    acceptCommands();
    render(<GroupEmailDialog personIds={[amara.id, tobi.id]} onOpenChange={() => {}} />);

    // A template that names the person starts on personal emails.
    expect(screen.getByRole("button", { name: /A personal email to each/ })).toHaveAttribute("aria-pressed", "true");

    const row = screen.getByText(/^Amara/).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /Open/ }));

    const link = decodeURIComponent(assign.mock.calls[0]![0]);
    expect(link).toMatch(/^mailto:amara@example.com\?/);
    expect(link).toContain("Hello Amara");
    expect(link).not.toContain("Tobi");

    fireEvent.click(within(row).getByRole("button", { name: "Yes, sent" }));
    await waitFor(() =>
      expect(lastCommand()).toMatchObject({
        name: "communication.logMany",
        input: { channel: "email", status: "sent_external", entries: [{ personId: amara.id }] },
      }),
    );
  });

  it("sends one email to everyone in BCC with a general greeting", async () => {
    const { amara, tobi } = church();
    acceptCommands();
    const onOpenChange = vi.fn();
    render(<GroupEmailDialog personIds={[amara.id, tobi.id]} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /One email to everyone/ }));
    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(message.value).toMatch(/^Hello everyone,/);

    fireEvent.click(screen.getByRole("button", { name: "Open in your email app" }));
    const link = decodeURIComponent(assign.mock.calls[0]![0]);
    expect(link).toMatch(/^mailto:\?bcc=amara@example.com,tobi@example.com&/);
    expect(link).toContain("Hello everyone,");

    fireEvent.click(screen.getByRole("button", { name: "I sent it" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(lastCommand()).toMatchObject({
      name: "communication.logMany",
      input: {
        status: "sent_external",
        entries: [
          { personId: amara.id, body: message.value },
          { personId: tobi.id, body: message.value },
        ],
      },
    });
  });

  it("won't open an email while a gap remains", () => {
    const { amara, tobi } = church();
    render(<GroupEmailDialog personIds={[amara.id, tobi.id]} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /One email to everyone/ }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Our {{groupName}} meets weekly" } });

    expect(screen.getByText(/still needs replacing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in your email app" })).toBeDisabled();
  });

  it("asks once for a detail nobody's record has, and puts it in every email", () => {
    // Only the welcome wording, and nobody with a first visit to date it by.
    const { amara, tobi } = church((snapshot) => ({
      ...snapshot,
      templates: snapshot.templates.filter((template) => template.category === "visitor_welcome"),
      people: snapshot.people.map((person) => ({ ...person, visitor: undefined })),
    }));
    render(<GroupEmailDialog personIds={[amara.id, tobi.id]} onOpenChange={() => {}} />);

    const row = screen.getByText(/^Amara/).closest("li")!;
    expect(within(row).getByRole("button", { name: /Open/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Which service/), { target: { value: "Sunday 12 October" } });

    fireEvent.click(within(row).getByRole("button", { name: /Open/ }));
    expect(decodeURIComponent(assign.mock.calls[0]![0])).toContain("on Sunday 12 October");
  });

  it("starts a group on a general message, not a visitor welcome", () => {
    const { amara, tobi } = church();
    render(<GroupEmailDialog personIds={[amara.id, tobi.id]} groupName="Young Adults" onOpenChange={() => {}} />);

    expect(screen.getByRole("combobox", { name: "What to say" })).toHaveTextContent("General check-in");
  });
});
