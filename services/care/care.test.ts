import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { ctx, snapshot, visitor } from "@/tests/factories";
import type { CareRecord } from "@/types/care";
import {
  addCareNote,
  createCareRecord,
  openCareRecords,
  scheduleCareAppointment,
  setAppointmentStatus,
  updateCareRecord,
} from "./care";

/**
 * Pastoral care. The rules under test are small, but the property that
 * matters is in every one of them: nothing written here is ever visible
 * outside the restricted view.
 */
function record(overrides: Partial<CareRecord> = {}): CareRecord {
  return {
    id: "care_existing",
    reference: "CARE-004",
    personId: "person_visitor",
    category: "prayer_request",
    summary: "Asked for prayer",
    receivedAt: "2026-10-10",
    status: "new",
    notes: [],
    appointments: [],
    createdAt: "2026-10-10T09:00:00.000Z",
    updatedAt: "2026-10-10T09:00:00.000Z",
    ...overrides,
  };
}

describe("createCareRecord", () => {
  it("opens a record with the next reference and a restricted first note", () => {
    const data = snapshot({ people: [visitor()], careRecords: [record({ reference: "CARE-004" })] });

    const outcome = unwrap(
      createCareRecord(
        data,
        {
          personId: "person_visitor",
          category: "hospital_visit",
          summary: "  In hospital this week  ",
          receivedAt: "2026-10-12",
          note: "  Ward 3, visiting hours 2–4pm  ",
        },
        ctx(),
      ),
    );

    const created = outcome.snapshot.careRecords.find((entry) => entry.id === outcome.careRecordId);
    expect(created).toMatchObject({
      reference: "CARE-005",
      summary: "In hospital this week",
      status: "new",
      assigneeId: undefined,
    });
    expect(created?.notes).toEqual([
      {
        at: "2026-10-12T09:00:00.000Z",
        by: TEAM_IDS.coordinator,
        text: "Ward 3, visiting hours 2–4pm",
        visibility: "restricted",
      },
    ]);
    expect(outcome.notices).toEqual(["CARE-005 created."]);
  });

  it("starts as assigned when it is given to somebody", () => {
    const data = snapshot({ people: [visitor()] });
    const outcome = unwrap(
      createCareRecord(
        data,
        {
          personId: "person_visitor",
          category: "bereavement",
          summary: "Lost her father",
          receivedAt: "2026-10-12",
          assigneeId: TEAM_IDS.pastor,
        },
        ctx(),
      ),
    );
    expect(outcome.snapshot.careRecords[0]).toMatchObject({
      status: "assigned",
      assigneeId: TEAM_IDS.pastor,
      notes: [],
    });
  });

  it("writes only a restricted activity entry, never a general one", () => {
    const data = snapshot({ people: [visitor()] });
    const outcome = unwrap(
      createCareRecord(
        data,
        { personId: "person_visitor", category: "other", summary: "x", receivedAt: "2026-10-12" },
        ctx(),
      ),
    );
    expect(outcome.snapshot.activity).toHaveLength(1);
    expect(outcome.snapshot.activity[0]).toMatchObject({
      type: "care.created",
      visibility: "restricted",
    });
    // The summary carries the reference, not the request.
    expect(outcome.snapshot.activity[0].summary).not.toContain("x");
  });

  it("refuses an unknown person and an empty summary", () => {
    const data = snapshot({ people: [visitor()] });
    const missing = createCareRecord(
      data,
      { personId: "person_nobody", category: "other", summary: "x", receivedAt: "2026-10-12" },
      ctx(),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("not_found");

    const blank = createCareRecord(
      data,
      { personId: "person_visitor", category: "other", summary: "   ", receivedAt: "2026-10-12" },
      ctx(),
    );
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("invalid");
    // And nothing was added.
    expect(data.careRecords).toHaveLength(0);
  });
});

describe("updateCareRecord", () => {
  it("changes only what was given and leaves the rest alone", () => {
    const data = snapshot({
      people: [visitor()],
      careRecords: [record({ nextAction: "Call on Monday", nextActionDate: "2026-10-13" })],
    });

    const outcome = unwrap(
      updateCareRecord(data, "care_existing", { status: "awaiting_response" }, ctx()),
    );
    expect(outcome.snapshot.careRecords[0]).toMatchObject({
      status: "awaiting_response",
      nextAction: "Call on Monday",
      nextActionDate: "2026-10-13",
      updatedAt: "2026-10-12T09:00:00.000Z",
    });
    expect(outcome.snapshot.activity[0].summary).toBe("CARE-004 updated — awaiting response.");
    expect(outcome.snapshot.activity[0].visibility).toBe("restricted");
  });

  it("clears the next action when given an empty string, keeps it when omitted", () => {
    const data = snapshot({ people: [visitor()], careRecords: [record({ nextAction: "Visit" })] });

    const kept = unwrap(updateCareRecord(data, "care_existing", { assigneeId: TEAM_IDS.pastor }, ctx()));
    expect(kept.snapshot.careRecords[0].nextAction).toBe("Visit");

    const cleared = unwrap(updateCareRecord(data, "care_existing", { nextAction: "   " }, ctx()));
    expect(cleared.snapshot.careRecords[0].nextAction).toBeUndefined();
  });

  it("does not mutate the snapshot it was given", () => {
    const original = record();
    const data = snapshot({ people: [visitor()], careRecords: [original] });
    unwrap(updateCareRecord(data, "care_existing", { status: "closed" }, ctx()));
    expect(original.status).toBe("new");
    expect(data.careRecords[0]).toBe(original);
  });

  it("refuses a record that does not exist", () => {
    const outcome = updateCareRecord(snapshot(), "care_missing", { status: "closed" }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("addCareNote", () => {
  it("appends a restricted note attributed to the actor, without a timeline entry", () => {
    const data = snapshot({ people: [visitor()], careRecords: [record()] });
    const outcome = unwrap(addCareNote(data, "care_existing", "  Spoke on the phone  ", ctx()));

    expect(outcome.snapshot.careRecords[0].notes).toEqual([
      {
        at: "2026-10-12T09:00:00.000Z",
        by: TEAM_IDS.coordinator,
        text: "Spoke on the phone",
        visibility: "restricted",
      },
    ]);
    // Notes are the most sensitive thing here; they do not even get a
    // restricted timeline entry.
    expect(outcome.snapshot.activity).toHaveLength(0);
    expect(outcome.notices).toEqual(["Restricted note added."]);
  });

  it("refuses an empty note and an unknown record", () => {
    const data = snapshot({ careRecords: [record()] });
    const blank = addCareNote(data, "care_existing", "  ", ctx());
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("invalid");

    const missing = addCareNote(data, "care_missing", "hello", ctx());
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("not_found");
  });
});

describe("appointments", () => {
  it("schedules an appointment and moves a new record into progress", () => {
    const data = snapshot({ people: [visitor()], careRecords: [record()] });
    const outcome = unwrap(
      scheduleCareAppointment(
        data,
        "care_existing",
        { date: "2026-10-15", time: "14:00", location: "  Church office " },
        ctx(),
      ),
    );

    const updated = outcome.snapshot.careRecords[0];
    expect(updated.status).toBe("in_progress");
    expect(updated.appointments).toEqual([
      {
        id: "appointment_1",
        date: "2026-10-15",
        time: "14:00",
        location: "Church office",
        status: "scheduled",
      },
    ]);
    expect(outcome.snapshot.activity[0]).toMatchObject({
      summary: "Appointment scheduled for CARE-004.",
      visibility: "restricted",
    });
  });

  it("leaves a record that is already underway at its current status", () => {
    const data = snapshot({
      people: [visitor()],
      careRecords: [record({ status: "awaiting_response" })],
    });
    const outcome = unwrap(
      scheduleCareAppointment(data, "care_existing", { date: "2026-10-15", time: "09:30" }, ctx()),
    );
    expect(outcome.snapshot.careRecords[0].status).toBe("awaiting_response");
    expect(outcome.snapshot.careRecords[0].appointments[0].location).toBeUndefined();
  });

  it("changes the status of one appointment and no other", () => {
    const data = snapshot({
      careRecords: [
        record({
          appointments: [
            { id: "a1", date: "2026-10-15", time: "14:00", status: "scheduled" },
            { id: "a2", date: "2026-10-16", time: "10:00", status: "scheduled" },
          ],
        }),
      ],
    });
    const outcome = unwrap(setAppointmentStatus(data, "care_existing", "a1", "completed", ctx()));
    expect(outcome.snapshot.careRecords[0].appointments.map((entry) => entry.status)).toEqual([
      "completed",
      "scheduled",
    ]);
  });

  it("refuses to touch a record that does not exist", () => {
    expect(
      scheduleCareAppointment(snapshot(), "care_missing", { date: "2026-10-15", time: "14:00" }, ctx())
        .ok,
    ).toBe(false);
    expect(setAppointmentStatus(snapshot(), "care_missing", "a1", "cancelled", ctx()).ok).toBe(false);
  });
});

describe("openCareRecords", () => {
  it("lists unresolved work, newest first", () => {
    const data = snapshot({
      careRecords: [
        record({ id: "c1", receivedAt: "2026-10-01", status: "new" }),
        record({ id: "c2", receivedAt: "2026-10-09", status: "resolved" }),
        record({ id: "c3", receivedAt: "2026-10-05", status: "in_progress" }),
        record({ id: "c4", receivedAt: "2026-10-07", status: "closed" }),
      ],
    });
    expect(openCareRecords(data).map((entry) => entry.id)).toEqual(["c3", "c1"]);
  });
});
