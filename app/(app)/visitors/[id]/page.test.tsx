import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { acceptCommands, freezeTime, lastCommand, resetHarness, seedChurch } from "@/tests/hooks-harness";
import type { ChurchSnapshot } from "@/types/snapshot";
import VisitorProfilePage from "./page";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const replace = vi.fn();
let personId = "";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: personId }),
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  usePathname: () => `/visitors/${personId}`,
  useSearchParams: () => new URLSearchParams(),
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
  replace.mockReset();
  resetHarness();
});

/** A visitor somebody other than Amara looks after, with none of Amara's tasks. */
function someoneElsesVisitor(snapshot: ChurchSnapshot) {
  const person = snapshot.people.find(
    (entry) =>
      entry.visitor?.assignedTo &&
      entry.visitor.assignedTo !== TEAM_IDS.volunteerAmara &&
      !entry.visitor.closure &&
      !entry.member &&
      !entry.contact.optedOut &&
      !snapshot.tasks.some((task) => task.personId === entry.id && task.assigneeId === TEAM_IDS.volunteerAmara),
  );
  if (!person) throw new Error("The seed has no visitor looked after by someone else.");
  personId = person.id;
  return person;
}

async function menuItems(): Promise<string[]> {
  const trigger = screen.queryByRole("button", { name: /^More for / });
  if (!trigger) return [];
  fireEvent.click(trigger);
  const menu = await screen.findByRole("menu");
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent ?? "");
}

describe("VisitorProfilePage (audit H3, M6, membership H5/M5)", () => {
  it("offers a volunteer nothing on someone else's visitor that the server would refuse", async () => {
    const full = seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    someoneElsesVisitor(full);
    // As the server sends it: a volunteer only receives their own tasks.
    seedChurch({
      role: "volunteer",
      teamMemberId: TEAM_IDS.volunteerAmara,
      snapshot: { ...full, tasks: full.tasks.filter((task) => task.assigneeId === TEAM_IDS.volunteerAmara) },
    });
    render(<VisitorProfilePage />);

    expect(await menuItems()).not.toContain("Stop following up");
    expect(screen.queryByText("How they like to be contacted")).toBeNull();
    expect(screen.queryByLabelText(/Who's looking after/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Make them a member/ })).toBeNull();
    expect(screen.getByText(/so their follow-ups aren't on your list/)).toBeInTheDocument();
  });

  it("lets an administrator stop following up and choose who looks after them", async () => {
    const snapshot = seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin });
    someoneElsesVisitor(snapshot);
    render(<VisitorProfilePage />);

    expect(await menuItems()).toContain("Stop following up");
    expect(screen.getByRole("button", { name: /Make them a member/ })).toBeInTheDocument();
  });

  it("offers a way back for a stopped follow-up", async () => {
    const snapshot = seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin });
    const person = someoneElsesVisitor(snapshot);
    const closed = {
      ...snapshot,
      people: snapshot.people.map((entry) =>
        entry.id === person.id
          ? {
              ...entry,
              visitor: {
                ...entry.visitor!,
                stageId: "closed",
                closure: { reason: "paused" as const, recordedAt: "2026-10-01T09:00:00.000Z" },
              },
            }
          : entry,
      ),
    };
    seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin, snapshot: closed });
    acceptCommands();
    render(<VisitorProfilePage />);

    const items = await menuItems();
    expect(items).toContain("Reopen follow-up");
    expect(items).not.toContain("Stop following up");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reopen follow-up" }));
    await waitFor(() => expect(lastCommand()).toMatchObject({ name: "visitor.reopenFollowUp" }));
  });

  it("sends a member with no visitor record to their member page", async () => {
    const snapshot = seedChurch();
    const member = snapshot.people.find((entry) => entry.member && !entry.visitor);
    if (!member) throw new Error("The seed has no plain member.");
    personId = member.id;
    render(<VisitorProfilePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/members/${member.id}`));
  });
});
