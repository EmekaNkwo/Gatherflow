import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TemplatesPage from "@/app/(app)/communications/templates/page";
import { TEAM_IDS } from "@/data/seed";
import { freezeTime, resetHarness, seedChurch } from "@/tests/hooks-harness";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
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

describe("Message templates page", () => {
  it("hides create, edit and delete from a volunteer (M4)", () => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    render(<TemplatesPage />);
    expect(screen.queryByRole("button", { name: /New template/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /General check-in/ })[0]);
    expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
  });

  it("signs the preview as whoever is signed in, not a fixed name (M1)", () => {
    seedChurch({ role: "pastor", teamMemberId: TEAM_IDS.pastor });
    render(<TemplatesPage />);
    expect(screen.getByRole("button", { name: /New template/ })).toBeInTheDocument();
    expect(screen.queryAllByText(/Grace Mensah/)).toHaveLength(0);
  });

  it("flags braces that aren't placeholders in the live preview (M5)", () => {
    seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin });
    render(<TemplatesPage />);
    fireEvent.click(screen.getByRole("button", { name: /New template/ }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi {{first-name}} and {firstName}" } });
    expect(screen.getByText(/would be sent exactly as typed/)).toHaveTextContent("{{first-name}}, {firstName}");
  });
});
