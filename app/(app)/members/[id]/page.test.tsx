import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import {
  acceptCommands,
  freezeTime,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
} from "@/tests/hooks-harness";
import type { ChurchSnapshot } from "@/types/snapshot";
import MemberProfilePage from "./page";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const replace = vi.fn();
let personId = "";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: personId }),
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  usePathname: () => `/members/${personId}`,
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

function firstMember(snapshot: ChurchSnapshot) {
  const person = snapshot.people.find((entry) => entry.member?.status === "active");
  if (!person) throw new Error("The seed has no active member.");
  personId = person.id;
  return person;
}

async function openMenu(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("menu");
}

describe("MemberProfilePage", () => {
  it("goes back to the member list once the record is deleted (L5)", async () => {
    const snapshot = seedChurch();
    const person = firstMember(snapshot);
    acceptCommands({
      change: (current) => ({ ...current, people: current.people.filter((entry) => entry.id !== person.id) }),
    });
    render(<MemberProfilePage />);

    await openMenu(/^More for /);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete their record" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete for good" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/members"));
    expect(lastCommand().name).toBe("person.delete");
  });

  it("stays put when the delete is refused, so the reason can be read", async () => {
    const snapshot = seedChurch();
    firstMember(snapshot);
    refuseCommands("Something went wrong.", "refused");
    render(<MemberProfilePage />);

    await openMenu(/^More for /);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete their record" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete for good" }));

    await waitFor(() => expect(lastCommand().name).toBe("person.delete"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers 'Edit details' to the administrator (M3) and nothing to a volunteer", async () => {
    const snapshot = seedChurch();
    firstMember(snapshot);
    const { unmount } = render(<MemberProfilePage />);
    await openMenu(/^More for /);
    expect(await screen.findByRole("menuitem", { name: "Edit details" })).toBeInTheDocument();
    unmount();

    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    render(<MemberProfilePage />);
    expect(screen.queryByRole("button", { name: /^More for / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("hides 'Note that orientation is done' once it's recorded (L1)", async () => {
    const snapshot = seedChurch();
    const person = firstMember(snapshot);
    seedChurch({
      snapshot: {
        ...snapshot,
        activity: [
          {
            id: "activity_oriented",
            type: "membership.orientation_completed",
            category: "membership",
            personId: person.id,
            summary: "Done.",
            at: "2026-10-01T09:00:00.000Z",
            visibility: "general",
          },
          ...snapshot.activity,
        ],
      },
    });
    render(<MemberProfilePage />);
    await openMenu(/^More for /);
    expect(await screen.findByRole("menuitem", { name: "Edit details" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Note that orientation is done" })).toBeNull();
  });
});
