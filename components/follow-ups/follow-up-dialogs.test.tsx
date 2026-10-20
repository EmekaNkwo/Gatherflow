import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { team, task, visitor } from "@/tests/factories";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { CompleteTaskDialog } from "./complete-task-dialog";
import { CreateTaskDialog, type NewTaskValues } from "./create-task-dialog";
import { TaskList } from "./task-list";

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
afterEach(() => vi.unstubAllGlobals());

const TODAY = "2026-10-12";
const activeTeam = team().filter((member) => member.active);

function looked(assignedTo?: string, permissionGranted = true) {
  return visitor({
    contact: { preferredMethod: "phone", permissionGranted, optedOut: false },
    visitor: { ...visitor().visitor!, assignedTo },
  });
}

function renderCreate(props: Partial<Parameters<typeof CreateTaskDialog>[0]> = {}) {
  const onConfirm = vi.fn<(values: NewTaskValues) => Promise<unknown>>(async () => undefined);
  render(
    <CreateTaskDialog
      open
      onOpenChange={() => {}}
      people={[looked(TEAM_IDS.volunteerAmara)]}
      team={activeTeam}
      today={TODAY}
      defaultDueInDays={3}
      personId="person_visitor"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return onConfirm;
}

describe("CreateTaskDialog (audit M5, M7, H1, H2)", () => {
  it("defaults to whoever looks after the visitor, not the first person on the team", async () => {
    const onConfirm = renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ assigneeId: TEAM_IDS.volunteerAmara });
  });

  it("gives a volunteer's follow-up to the volunteer", async () => {
    const onConfirm = renderCreate({
      people: [looked(TEAM_IDS.coordinator)],
      ownOnly: true,
      currentMemberId: TEAM_IDS.volunteerAmara,
    });
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ assigneeId: TEAM_IDS.volunteerAmara });
  });

  it("refuses a day in the past and offers nothing earlier than today", () => {
    renderCreate();
    const when = screen.getByLabelText("When");
    expect(when).toHaveAttribute("min", TODAY);
    fireEvent.change(when, { target: { value: "2026-10-01" } });
    expect(screen.getByRole("button", { name: "Add follow-up" })).toBeDisabled();
    expect(screen.getByText("Choose today or a later day.")).toBeInTheDocument();
  });

  it("adds once however many times it is tapped", async () => {
    let release: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    renderCreate({ onConfirm });
    const add = screen.getByRole("button", { name: "Add follow-up" });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled());
    await act(async () => release());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("only offers a hello in person for somebody who hasn't agreed to be contacted", async () => {
    const onConfirm = renderCreate({ people: [looked(undefined, false)] });
    expect(screen.getByText(/hasn't agreed to be contacted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0].type).not.toBe("check_in");
    expect(["say_hello", "pastoral_contact", "membership_orientation"]).toContain(onConfirm.mock.calls[0][0].type);
  });
});

function entry(overrides: Partial<TaskWithPerson> = {}): TaskWithPerson {
  return {
    task: task(),
    person: visitor(),
    assigneeName: "Amara Nwosu",
    ownerInactive: false,
    overdue: false,
    dueToday: true,
    ...overrides,
  };
}

describe("CompleteTaskDialog (audit M4)", () => {
  it("needs a note before 'Something else happened' can be saved", async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<CompleteTaskDialog task={entry()} onOpenChange={() => {}} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    fireEvent.click(screen.getByLabelText("Something else happened"));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/doesn't count as a try/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Met their sister" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("other", "Met their sister"));
  });
});

describe("TaskList (audit H3)", () => {
  it("only offers what the gate allows for each follow-up", () => {
    render(
      <TaskList
        tasks={[entry()]}
        now={new Date("2026-10-12T09:00:00.000Z")}
        emptyMessage=""
        allows={(action) => action === "reschedule"}
        onComplete={() => {}}
        onReschedule={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Done/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Do it later/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^More for/ })).toBeNull();
  });

  it("says when a follow-up is with somebody no longer active", () => {
    render(
      <TaskList
        tasks={[entry({ assigneeName: "Esther Bello", ownerInactive: true })]}
        now={new Date("2026-10-12T09:00:00.000Z")}
        emptyMessage=""
        showAssignee
      />,
    );
    expect(screen.getByText(/Esther Bello \(no longer active\)/)).toBeInTheDocument();
  });
});
