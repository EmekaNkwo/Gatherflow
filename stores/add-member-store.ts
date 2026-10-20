"use client";

import { create } from "zustand";

/**
 * The "Add a member" modal, opened from the members list or the New menu.
 * `opening` changes every time it opens, so it starts with an empty form.
 */
export interface AddMemberStore {
  open: boolean;
  opening: number;
  show: () => void;
  hide: () => void;
}

export const useAddMemberStore = create<AddMemberStore>((set) => ({
  open: false,
  opening: 0,
  show: () => set((state) => ({ open: true, opening: state.opening + 1 })),
  hide: () => set({ open: false }),
}));
