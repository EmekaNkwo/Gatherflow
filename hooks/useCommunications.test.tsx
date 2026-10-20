import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { err, ok } from "@/lib/result";
import type { MessageDraft } from "@/services/communications/messaging";
import { useChurchStore } from "@/stores/church-store";
import {
  acceptCommands,
  freezeTime,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  seedSnapshot,
  toastMock,
  transport,
} from "@/tests/hooks-harness";
import { useCommunications, usePersonCommunications } from "./useCommunications";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const writeText = vi.fn<(text: string) => Promise<void>>();
const openWindow = vi.fn();

const draft: MessageDraft = {
  personId: "person_1",
  templateId: "template_1",
  channel: "whatsapp",
  body: "Hello Stephen",
  missing: [],
  recentContactCount: 0,
};

beforeEach(() => {
  freezeTime();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.stubGlobal("open", openWindow);
  writeText.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetHarness();
});

describe("useCommunications data", () => {
  it("sorts templates by name", () => {
    seedChurch();
    const { result } = renderHook(() => useCommunications());

    const names = result.current.templates.map((template) => template.name);
    expect(names).toHaveLength(7);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
    expect(names[0]).toBe("Connect-group invitation");
  });

  it("lists the communication log newest first, joined to person, actor and template", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useCommunications());

    expect(result.current.history).toHaveLength(snapshot.communications.length);
    const times = result.current.history.map((item) => item.entry.at);
    expect(times).toEqual([...times].sort().reverse());
    for (const item of result.current.history) {
      expect(item.person?.id).toBe(item.entry.personId);
      expect(item.actor?.id).toBe(item.entry.actorId);
      expect(item.template?.id).toBe(item.entry.templateId);
    }
  });

  it("exposes the email availability the server reported", () => {
    const email = { configured: true, enabled: true, pilot: false };
    seedChurch({ email });
    const { result } = renderHook(() => useCommunications());
    expect(result.current.email).toEqual(email);
  });
});

describe("useCommunications.prepare", () => {
  // person_1 is Stephen Achebe, who prefers to be called Steve.
  it("drafts a message in the person's preferred name, signed by the signed-in team member", () => {
    seedChurch({ role: "follow_up_coordinator", teamMemberId: TEAM_IDS.coordinator });
    const { result } = renderHook(() => useCommunications());

    const outcome = result.current.prepare({ personId: "person_1", templateId: "template_1" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.channel).toBe("whatsapp");
    expect(outcome.value.body).toMatch(/^Hello Steve, thank you for worshipping with us at Grace Community Church/);
    expect(outcome.value.body).toMatch(/Grace Mensah$/);
  });

  it("signs as the church team when the account has no team member", () => {
    seedChurch({ role: "administrator", teamMemberId: null });
    const { result } = renderHook(() => useCommunications());

    const outcome = result.current.prepare({ personId: "person_1", templateId: "template_1" });
    expect(outcome.ok && outcome.value.body).toMatch(/the church team$/);
  });

  it("refuses to draft for someone who opted out, without dispatching anything", () => {
    seedChurch();
    const { result } = renderHook(() => useCommunications());

    const outcome = result.current.prepare({ personId: "person_137", templateId: "template_1" });

    expect(outcome).toMatchObject({ ok: false, code: "opted_out" });
    expect(transport.postCommand).not.toHaveBeenCalled();
  });
});

describe("useCommunications logging", () => {
  beforeEach(() => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    acceptCommands({ notices: ["Logged."] });
  });

  it("logs a manual communication", async () => {
    const { result } = renderHook(() => useCommunications());
    const input = { personId: "person_1", channel: "phone" as const, status: "drafted" as const, body: "Called" };

    const outcome = await invoke(() => result.current.log(input));

    expect(lastCommand()).toEqual({ name: "communication.log", input });
    expect(outcome).toMatchObject({ ok: true });
  });

  it("records first, then copies the final text", async () => {
    const { result } = renderHook(() => useCommunications());

    const done = await invoke(() => result.current.copyAndLog(draft, "Hello Stephen, edited", "task_19"));

    expect(done).toBe(true);
    expect(writeText).toHaveBeenCalledWith("Hello Stephen, edited");
    expect(lastCommand()).toEqual({
      name: "communication.log",
      input: {
        personId: "person_1",
        channel: "whatsapp",
        status: "copied",
        body: "Hello Stephen, edited",
        templateId: "template_1",
        taskId: "task_19",
      },
    });
    expect(toastMock.success).toHaveBeenCalledWith("Copied");
  });

  it("copies nothing when the server refuses, e.g. the person has just opted out", async () => {
    refuseCommands("Stephen Achebe has opted out of contact.");
    const { result } = renderHook(() => useCommunications());

    const done = await invoke(() => result.current.copyAndLog(draft, "Hello Stephen"));

    expect(done).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("Stephen Achebe has opted out of contact.");
  });

  it("says so when the clipboard is unavailable", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useCommunications());

    const done = await invoke(() => result.current.copyAndLog(draft, "Hello Stephen"));

    expect(done).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith("Could not reach the clipboard. Select the text and copy it yourself.");
  });

  it("opens WhatsApp with the full number and the edited words, after the record is accepted", async () => {
    const snapshot = useChurchStore.getState().snapshot!;
    const phone = snapshot.people.find((person) => person.id === "person_1")!.phone!;
    const { result } = renderHook(() => useCommunications());

    const done = await invoke(() => result.current.openExternally(draft, "Edited text", "task_19"));

    expect(done).toBe(true);
    const digits = phone.replace(/\D/g, "");
    expect(openWindow).toHaveBeenCalledWith(
      `https://wa.me/${digits}?text=Edited%20text`,
      "_blank",
      "noopener,noreferrer",
    );
    expect(lastCommand()).toMatchObject({
      name: "communication.log",
      input: { status: "opened_external", body: "Edited text", taskId: "task_19" },
    });
  });

  it("opens nothing when the server refuses", async () => {
    refuseCommands("Stephen Achebe has opted out of contact.");
    const { result } = renderHook(() => useCommunications());

    const done = await invoke(() => result.current.openExternally(draft, "Hello"));

    expect(done).toBe(false);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("refuses to open anything when there is no contact detail for the channel", async () => {
    const { result } = renderHook(() => useCommunications());

    await invoke(() => result.current.openExternally({ ...draft, channel: "in_person" }, "Hello"));

    expect(openWindow).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("There's no usable contact detail for that way of sending.");
    expect(transport.postCommand).not.toHaveBeenCalled();
  });
});

describe("useCommunications.sendEmail", () => {
  const request = { personId: "person_2", templateId: "template_1" };

  it("queues the email, adopts the returned snapshot and says it is queued", async () => {
    seedChurch({ role: "follow_up_coordinator", teamMemberId: TEAM_IDS.coordinator });
    const returned = seedSnapshot();
    const receipt = { communicationId: "comm_99", outboxId: "outbox_1", toEmail: "stephen.dube@example.com" };
    transport.postEmail.mockResolvedValue(ok({ snapshot: returned, notices: [], data: receipt }));
    const { result } = renderHook(() => useCommunications());

    const outcome = await invoke(() => result.current.sendEmail(request));

    expect(transport.postEmail).toHaveBeenCalledWith(request);
    expect(outcome).toEqual({ ok: true, value: receipt });
    expect(useChurchStore.getState().snapshot).toBe(returned);
    expect(toastMock.success).toHaveBeenCalledWith("Email queued", {
      description: "It will be sent to stephen.dube@example.com within a few minutes.",
    });
  });

  it("surfaces a refusal from the server", async () => {
    seedChurch();
    transport.postEmail.mockResolvedValue(err("Email is not enabled for this church.", "email_disabled"));
    const { result } = renderHook(() => useCommunications());

    const outcome = await invoke(() => result.current.sendEmail(request));

    expect(outcome).toEqual({ ok: false, error: "Email is not enabled for this church.", code: "email_disabled" });
    expect(toastMock.error).toHaveBeenCalledWith("Email is not enabled for this church.");
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("useCommunications templates", () => {
  beforeEach(() => {
    seedChurch({ role: "administrator" });
    acceptCommands({ notices: ["Template saved."] });
  });

  const input = { name: "Birthday", category: "general", channels: ["sms"], body: "Happy birthday {{firstName}}" } as never;

  it.each([
    ["addTemplate", (hook: ReturnType<typeof useCommunications>) => hook.addTemplate(input), "template.create", input],
    [
      "editTemplate",
      (hook: ReturnType<typeof useCommunications>) => hook.editTemplate("template_7", input),
      "template.update",
      { templateId: "template_7", input },
    ],
    [
      "removeTemplate",
      (hook: ReturnType<typeof useCommunications>) => hook.removeTemplate("template_7"),
      "template.delete",
      { templateId: "template_7" },
    ],
  ] as const)("%s dispatches the matching command", async (_label, action, name, expected) => {
    const { result } = renderHook(() => useCommunications());
    await invoke(() => action(result.current));
    expect(lastCommand()).toEqual({ name, input: expected });
  });

  it("returns a refusal for a built-in template", async () => {
    refuseCommands("Built-in templates cannot be deleted.", "built_in");
    const { result } = renderHook(() => useCommunications());

    const outcome = await invoke(() => result.current.removeTemplate("template_1"));

    expect(outcome).toMatchObject({ ok: false, code: "built_in" });
    expect(toastMock.error).toHaveBeenCalledWith("Built-in templates cannot be deleted.");
  });
});

describe("usePersonCommunications", () => {
  it("lists one person's log, newest first", () => {
    const snapshot = seedChurch();
    const personId = snapshot.communications[0].personId;
    const { result } = renderHook(() => usePersonCommunications(personId));

    expect(result.current).toHaveLength(
      snapshot.communications.filter((entry) => entry.personId === personId).length,
    );
    expect(result.current.every((entry) => entry.personId === personId)).toBe(true);
    const times = result.current.map((entry) => entry.at);
    expect(times).toEqual([...times].sort().reverse());
  });
});
