import { addDaysIso } from "@/lib/dates";
import type { Group, GroupMembership, GroupType, Weekday } from "@/types/group";
import type { Person } from "@/types/person";
import { at, type SeedContext } from "./context";
import { TEAM_IDS } from "./team";

interface GroupBlueprint {
  name: string;
  description: string;
  type: GroupType;
  weekday: Weekday;
  time: string;
  location: string;
  size: number;
  involvesMinors: boolean;
  active: boolean;
}

const BLUEPRINTS: readonly GroupBlueprint[] = [
  {
    name: "Riverside Connect Group",
    description: "Midweek connect group for the Riverside area.",
    type: "connect_group",
    weekday: "tuesday",
    time: "19:00",
    location: "Riverside — host home",
    size: 9,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Oakfield Connect Group",
    description: "Connect group meeting fortnightly in Oakfield.",
    type: "connect_group",
    weekday: "thursday",
    time: "19:30",
    location: "Oakfield — host home",
    size: 7,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Worship Team",
    description: "Sunday worship band and vocalists.",
    type: "choir",
    weekday: "saturday",
    time: "10:00",
    location: "Main auditorium",
    size: 11,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Ushering Team",
    description: "Welcomes people and serves on the door each Sunday.",
    type: "ministry",
    weekday: "sunday",
    time: "09:15",
    location: "Foyer",
    size: 8,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Media Team",
    description: "Sound, projection and livestream.",
    type: "ministry",
    weekday: "sunday",
    time: "09:00",
    location: "Media desk",
    size: 5,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Prayer Team",
    description: "Prays through requests received during the week.",
    type: "prayer",
    weekday: "friday",
    time: "19:00",
    location: "Prayer room",
    size: 6,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Youth Ministry",
    description: "Saturday gathering for 13–18s.",
    type: "youth",
    weekday: "saturday",
    time: "16:00",
    location: "Youth hall",
    size: 6,
    involvesMinors: true,
    active: true,
  },
  {
    name: "Children's Ministry",
    description: "Sunday groups for under-12s.",
    type: "children",
    weekday: "sunday",
    time: "10:00",
    location: "Children's rooms",
    size: 5,
    involvesMinors: true,
    active: true,
  },
  {
    name: "Community Outreach",
    description: "Monthly food bank partnership and street outreach.",
    type: "outreach",
    weekday: "saturday",
    time: "11:00",
    location: "Market Quarter",
    size: 7,
    involvesMinors: false,
    active: true,
  },
  {
    name: "Men's Breakfast",
    description: "Paused for the season while a new leader is found.",
    type: "connect_group",
    weekday: "saturday",
    time: "08:30",
    location: "Church café",
    size: 0,
    involvesMinors: false,
    active: false,
  },
];

export interface SeededGroups {
  groups: Group[];
  /** People updated with their group memberships. */
  people: Person[];
}

/**
 * Group membership is always an explicit, recorded assignment — the seed
 * stamps `addedBy` on every membership for the same reason the UI does.
 */
export function createGroups(ctx: SeedContext, input: readonly Person[]): SeededGroups {
  const people = [...input];
  const groups: Group[] = [];
  const membershipByPerson = new Map<string, string[]>();

  const eligible = people.filter(
    (person) => person.kind === "member" && person.member?.status !== "archived",
  );

  let cursor = 0;

  BLUEPRINTS.forEach((blueprint, index) => {
    const id = ctx.id("group");
    const members: GroupMembership[] = [];
    const createdAt = at(addDaysIso(ctx.today, -400 + index * 10), 10);

    for (let seat = 0; seat < blueprint.size; seat += 1) {
      const person = eligible[(cursor + seat * 2) % eligible.length];
      if (!person || members.some((entry) => entry.personId === person.id)) continue;
      members.push({
        personId: person.id,
        joinedAt: at(addDaysIso(ctx.today, -ctx.int(30, 360)), 19),
        addedBy: TEAM_IDS.admin,
        role: seat === 0 ? "leader" : "member",
      });
      const existing = membershipByPerson.get(person.id) ?? [];
      membershipByPerson.set(person.id, [...existing, id]);
    }
    cursor += blueprint.size;

    groups.push({
      id,
      name: blueprint.name,
      description: blueprint.description,
      type: blueprint.type,
      leaderId: members[0]?.personId,
      members,
      schedule: {
        weekday: blueprint.weekday,
        time: blueprint.time,
        frequency: blueprint.type === "outreach" ? "monthly" : "weekly",
      },
      location: blueprint.location,
      active: blueprint.active,
      involvesMinors: blueprint.involvesMinors,
      createdAt,
    });
  });

  return {
    groups,
    people: people.map((person) => {
      const groupIds = membershipByPerson.get(person.id);
      return groupIds ? { ...person, groupIds } : person;
    }),
  };
}
