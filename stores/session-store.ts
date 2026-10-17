"use client";

import { create } from "zustand";
import { capabilitiesFor, can, taskScope } from "@/lib/permissions";
import type { Capability, DemoRole } from "@/types/team";
import { setSessionAdopter } from "./church-store";

/**
 * Who the signed-in account is acting as.
 *
 * Both fields come from the server with every church load — the role from
 * the membership row, the team member from the link the administrator made —
 * and nothing here can change them. What the interface does with them is
 * advisory: it hides what the server would refuse anyway.
 */
export interface SessionStore {
  role: DemoRole;
  teamMemberId: string | null;
  /** True once the server has said who this is. */
  resolved: boolean;

  adoptServerSession: (role: DemoRole, teamMemberId: string | null) => void;
  can: (capability: Capability) => boolean;
  capabilities: () => readonly Capability[];
  taskScope: () => "all" | "own" | "none";
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  // Until the server answers, the least capable role: nothing is offered
  // that might then be refused.
  role: "member",
  teamMemberId: null,
  resolved: false,

  adoptServerSession: (role, teamMemberId) => {
    set({ role, teamMemberId, resolved: true });
  },

  can: (capability) => can(get().role, capability),
  capabilities: () => capabilitiesFor(get().role),
  taskScope: () => taskScope(get().role),
}));

setSessionAdopter((role, teamMemberId) =>
  useSessionStore.getState().adoptServerSession(role, teamMemberId),
);
