import type { TeamMember } from "@/types/team";
import { at, type SeedContext } from "./context";

/**
 * The demo team. Ids are stable and readable so seed references, tests and
 * the role switcher can all point at the same people.
 */
export const TEAM_IDS = {
  admin: "tm_admin_ruth",
  pastor: "tm_pastor_daniel",
  coordinator: "tm_coord_grace",
  volunteerAmara: "tm_vol_amara",
  volunteerTunde: "tm_vol_tunde",
  volunteerEsther: "tm_vol_esther",
  careLead: "tm_care_joanna",
  member: "tm_member_samuel",
} as const;

export function createTeam(ctx: SeedContext): TeamMember[] {
  const createdAt = at(ctx.thisWeek, 9);

  return [
    {
      id: TEAM_IDS.admin,
      name: "Ruth Adeyemi",
      role: "administrator",
      active: true,
      title: "Church administrator",
      createdAt,
    },
    {
      id: TEAM_IDS.pastor,
      name: "Pastor Daniel Okonkwo",
      role: "pastor",
      active: true,
      title: "Lead pastor",
      createdAt,
    },
    {
      id: TEAM_IDS.coordinator,
      name: "Grace Mensah",
      role: "follow_up_coordinator",
      active: true,
      title: "Follow-up coordinator",
      createdAt,
    },
    {
      id: TEAM_IDS.volunteerAmara,
      name: "Amara Nwosu",
      role: "volunteer",
      active: true,
      title: "Welcome desk",
      createdAt,
    },
    {
      id: TEAM_IDS.volunteerTunde,
      name: "Tunde Balogun",
      role: "volunteer",
      active: true,
      title: "Follow-up team",
      createdAt,
    },
    {
      id: TEAM_IDS.volunteerEsther,
      name: "Esther Bello",
      role: "volunteer",
      active: false,
      title: "Follow-up team (on a break)",
      createdAt,
    },
    {
      id: TEAM_IDS.careLead,
      name: "Joanna Afolabi",
      role: "pastor",
      active: true,
      title: "Pastoral care lead",
      createdAt,
    },
    {
      id: TEAM_IDS.member,
      name: "Samuel Eze",
      role: "member",
      active: true,
      title: "Church member",
      createdAt,
    },
  ];
}

/** Volunteers and coordinators that automated rules may assign work to. */
export const ASSIGNABLE_TEAM_IDS: readonly string[] = [
  TEAM_IDS.coordinator,
  TEAM_IDS.volunteerAmara,
  TEAM_IDS.volunteerTunde,
];
