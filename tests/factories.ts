import { createSettings } from "@/data/seed/settings";
import { TEAM_IDS } from "@/data/seed/team";
import { createSequentialIdFactory } from "@/lib/ids";
import { createCommandContext, type CommandContext } from "@/services/core/context";
import type { AttendanceRecord, AttendanceSession } from "@/types/attendance";
import type { FollowUpTask } from "@/types/follow-up";
import type { Group } from "@/types/group";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { TeamMember } from "@/types/team";

/**
 * Small, explicit fixtures for the unit tests. These are deliberately
 * hand-built rather than generated, so each test states exactly the state
 * the rule under test depends on.
 */

export const NOW = new Date("2026-10-12T09:00:00.000Z");
export const TODAY = "2026-10-12";

export function ctx(overrides: Partial<Parameters<typeof createCommandContext>[0]> = {}): CommandContext {
  return createCommandContext({
    actorId: TEAM_IDS.coordinator,
    now: NOW,
    id: createSequentialIdFactory(),
    ...overrides,
  });
}

export function team(): TeamMember[] {
  return [
    {
      id: TEAM_IDS.coordinator,
      name: "Grace Mensah",
      role: "follow_up_coordinator",
      active: true,
      createdAt: "2026-01-01T09:00:00.000Z",
    },
    {
      id: TEAM_IDS.volunteerAmara,
      name: "Amara Nwosu",
      role: "volunteer",
      active: true,
      createdAt: "2026-01-01T09:00:00.000Z",
    },
    {
      id: TEAM_IDS.volunteerEsther,
      name: "Esther Bello",
      role: "volunteer",
      active: false,
      createdAt: "2026-01-01T09:00:00.000Z",
    },
    {
      id: TEAM_IDS.admin,
      name: "Ruth Adeyemi",
      role: "administrator",
      active: true,
      createdAt: "2026-01-01T09:00:00.000Z",
    },
    {
      id: TEAM_IDS.careLead,
      name: "Joanna Afolabi",
      role: "pastor",
      active: true,
      createdAt: "2026-01-01T09:00:00.000Z",
    },
  ];
}

export function visitor(overrides: Partial<Person> = {}): Person {
  return {
    id: "person_visitor",
    kind: "visitor",
    firstName: "Tunde",
    lastName: "Balogun",
    phone: "+44 7700 900111",
    email: "tunde.balogun@example.com",
    ageGroup: "adult",
    interests: [],
    groupIds: [],
    contact: { preferredMethod: "whatsapp", permissionGranted: true, optedOut: false },
    visitor: {
      firstVisitDate: "2026-10-04",
      source: "invitation",
      stageId: "new_visitor",
      stageUpdatedAt: "2026-10-04T12:00:00.000Z",
      contactAttempts: 0,
    },
    createdAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T12:00:00.000Z",
    ...overrides,
  };
}

export function member(overrides: Partial<Person> = {}): Person {
  return {
    id: "person_member",
    kind: "member",
    firstName: "Grace",
    lastName: "Adeyemi",
    phone: "+44 7700 900222",
    ageGroup: "adult",
    interests: [],
    groupIds: [],
    contact: { preferredMethod: "phone", permissionGranted: true, optedOut: false },
    member: {
      reference: "MEM-0001",
      status: "active",
      membershipDate: "2024-03-10",
      statusHistory: [
        {
          status: "new_member",
          changedAt: "2024-03-10T11:00:00.000Z",
          changedBy: TEAM_IDS.admin,
          reason: "Membership registered",
        },
      ],
    },
    createdAt: "2024-03-10T11:00:00.000Z",
    updatedAt: "2024-03-10T11:00:00.000Z",
    ...overrides,
  };
}

export function session(overrides: Partial<AttendanceSession> = {}): AttendanceSession {
  return {
    id: "session_sunday",
    name: "Sunday service",
    date: "2026-10-11",
    startTime: "10:00",
    type: "sunday_service",
    createdAt: "2026-10-11T08:00:00.000Z",
    ...overrides,
  };
}

export function task(overrides: Partial<FollowUpTask> = {}): FollowUpTask {
  return {
    id: "task_fixture",
    reference: "FU-0001",
    personId: "person_visitor",
    type: "welcome_message",
    assigneeId: TEAM_IDS.volunteerAmara,
    priority: "normal",
    dueDate: TODAY,
    status: "pending",
    origin: "manual",
    rescheduleHistory: [],
    createdAt: "2026-10-05T09:00:00.000Z",
    createdBy: TEAM_IDS.coordinator,
    ...overrides,
  };
}

export function group(overrides: Partial<Group> = {}): Group {
  return {
    id: "group_connect",
    name: "Riverside Connect Group",
    description: "Midweek connect group.",
    type: "connect_group",
    members: [],
    active: true,
    involvesMinors: false,
    createdAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

export function attendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "attendance_fixture",
    sessionId: "session_sunday",
    personId: "person_visitor",
    method: "search",
    status: "present",
    recordedAt: "2026-10-11T10:00:00.000Z",
    recordedBy: TEAM_IDS.volunteerAmara,
    firstVisit: true,
    corrections: [],
    ...overrides,
  };
}

export function snapshot(overrides: Partial<ChurchSnapshot> = {}): ChurchSnapshot {
  return {
    people: [],
    households: [],
    groups: [],
    tasks: [],
    sessions: [],
    attendance: [],
    careRecords: [],
    templates: [],
    communications: [],
    team: team(),
    activity: [],
    settings: createSettings(),
    ...overrides,
  };
}
