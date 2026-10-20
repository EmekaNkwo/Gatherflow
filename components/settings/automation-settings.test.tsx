import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { commandFor } from "@/services/commands/registry";
import { acceptCommands, freezeTime, resetHarness, seedChurch, transport } from "@/tests/hooks-harness";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { AutomationSettings } from "./automation-settings";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

function Harness() {
  return <AutomationSettings settings={useChurchSettings()} />;
}

beforeEach(() => {
  freezeTime();
  seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin });
  acceptCommands();
});

afterEach(() => {
  resetHarness();
});

describe("AutomationSettings", () => {
  it("saves the number typed once, on leaving the box, not on every keystroke (H3)", async () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: /Details/ })[0]);
    const box = screen.getAllByLabelText("Due in (days)")[0];

    fireEvent.change(box, { target: { value: "" } });
    fireEvent.change(box, { target: { value: "1" } });
    fireEvent.change(box, { target: { value: "14" } });
    expect(transport.postCommand).not.toHaveBeenCalled();

    fireEvent.blur(box);
    await waitFor(() => expect(transport.postCommand).toHaveBeenCalledTimes(1));
    expect(transport.postCommand.mock.calls[0][1]).toMatchObject({ changes: { dueInDays: 14 } });
  });

  it("asks for a number instead of saving an empty box as 0 (H3/M7)", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: /Details/ })[0]);
    const box = screen.getAllByLabelText("Due in (days)")[0];

    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(screen.getByText("Enter a number of days, from 0 to 90.")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "100" } });
    fireEvent.blur(box);
    expect(screen.getByText("Choose between 0 and 90 days.")).toBeInTheDocument();
    expect(transport.postCommand).not.toHaveBeenCalled();
  });

  it("sends null for Nobody yet, and the command accepts it (H4)", async () => {
    const { result } = renderHook(() => useChurchSettings());
    await result.current.saveRule("first_visit_welcome", { defaultAssigneeId: null });
    expect(transport.postCommand.mock.calls[0][1]).toEqual({
      id: "first_visit_welcome",
      changes: { defaultAssigneeId: null },
    });
    const parsed = commandFor("settings.updateAutomationRule").schema.safeParse({
      id: "first_visit_welcome",
      changes: { defaultAssigneeId: null },
    });
    expect(parsed.success).toBe(true);
  });
});
