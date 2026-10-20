import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeTime, resetHarness, seedChurch } from "@/tests/hooks-harness";
import { group, member } from "@/tests/factories";
import GroupPage from "./page";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "group_test" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
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
  resetHarness();
});

function church() {
  const base = seedChurch();
  const profile = member().member!;
  return seedChurch({
    snapshot: {
      ...base,
      groups: [...base.groups, group({ id: "group_test", name: "Test Group" })],
      people: [
        ...base.people,
        member({
          id: "p_steve",
          firstName: "Stephen",
          lastName: "Zwelithini",
          preferredName: "Steve",
          member: { ...profile, reference: "MEM-9001" },
        }),
        member({
          id: "p_gone",
          firstName: "Stephanie",
          lastName: "Zwelithini",
          member: { ...profile, reference: "MEM-9002", status: "transferred" },
        }),
      ],
    },
  });
}

describe("GroupPage add someone", () => {
  it("finds people by the name the app shows (M1) and hides people who have left (L3)", () => {
    church();
    render(<GroupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add someone" }));
    fireEvent.change(screen.getByLabelText("Search people to add"), { target: { value: "Steve Zwelithini" } });

    expect(screen.getByRole("button", { name: "Add Steve Zwelithini" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search people to add"), { target: { value: "zwelithini" } });
    expect(screen.queryByRole("button", { name: /Add Stephanie/ })).toBeNull();
  });
});
