"use client";

import { create } from "zustand";
import { TEAM_IDS } from "@/data/seed";
import { capabilitiesFor, can, taskScope } from "@/lib/permissions";
import { createLocalStorage } from "@/services/repositories/storage";
import { STORAGE_NAMESPACE } from "@/services/repositories/collection";
import type { Capability, DemoRole } from "@/types/team";
import { setActorResolver } from "./church-store";

/**
 * The simulated session: which demo role is being used and which team
 * member actions are recorded against.
 *
 * This is a demonstration of role-based *interfaces*, not security. The
 * value lives in the browser and the README says so plainly.
 */
export interface SessionStore {
  role: DemoRole;
  teamMemberId: string;
  /** Mirrors the stored preference once hydration has run. */
  hydrated: boolean;

  hydrate: () => void;
  switchRole: (role: DemoRole) => void;
  setTeamMember: (teamMemberId: string, role: DemoRole) => void;
  can: (capability: Capability) => boolean;
  capabilities: () => readonly Capability[];
  taskScope: () => "all" | "own" | "none";
}

const SESSION_KEY = `${STORAGE_NAMESPACE}:session`;

const DEFAULT_MEMBER_BY_ROLE: Record<DemoRole, string> = {
  administrator: TEAM_IDS.admin,
  pastor: TEAM_IDS.pastor,
  follow_up_coordinator: TEAM_IDS.coordinator,
  volunteer: TEAM_IDS.volunteerAmara,
  member: TEAM_IDS.member,
};

function readStored(): { role: DemoRole; teamMemberId: string } | null {
  const adapter = createLocalStorage();
  const raw = adapter.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { role?: string; teamMemberId?: string };
    if (!parsed.role || !(parsed.role in DEFAULT_MEMBER_BY_ROLE)) return null;
    const role = parsed.role as DemoRole;
    return { role, teamMemberId: parsed.teamMemberId ?? DEFAULT_MEMBER_BY_ROLE[role] };
  } catch {
    return null;
  }
}

function persist(role: DemoRole, teamMemberId: string): void {
  createLocalStorage().setItem(SESSION_KEY, JSON.stringify({ role, teamMemberId }));
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  role: "follow_up_coordinator",
  teamMemberId: TEAM_IDS.coordinator,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const stored = readStored();
    set({
      role: stored?.role ?? "follow_up_coordinator",
      teamMemberId: stored?.teamMemberId ?? TEAM_IDS.coordinator,
      hydrated: true,
    });
  },

  switchRole: (role) => {
    const teamMemberId = DEFAULT_MEMBER_BY_ROLE[role];
    persist(role, teamMemberId);
    set({ role, teamMemberId });
  },

  setTeamMember: (teamMemberId, role) => {
    persist(role, teamMemberId);
    set({ teamMemberId, role });
  },

  can: (capability) => can(get().role, capability),
  capabilities: () => capabilitiesFor(get().role),
  taskScope: () => taskScope(get().role),
}));

// Commands are always recorded against the acting team member.
setActorResolver(() => useSessionStore.getState().teamMemberId);
