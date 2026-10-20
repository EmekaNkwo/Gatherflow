"use client";

import { create } from "zustand";

/**
 * The "Welcome someone new" modal, which any screen can open: the Today
 * button, the Welcome tab, check-in, the search palette, the New menu.
 *
 * It has two modes: the quick welcome (a name and a number, one person after
 * another) and the full form (everything, for when there is time). Opened
 * for a particular service (from check-in), it checks people in to that one;
 * otherwise to the most recent. `opening` changes every time it opens, so
 * the modal starts afresh rather than showing the last person's details.
 */
export type WelcomeMode = "quick" | "full";

export interface WelcomeStore {
  open: boolean;
  mode: WelcomeMode;
  sessionId: string | undefined;
  opening: number;
  show: (options?: { sessionId?: string; mode?: WelcomeMode }) => void;
  setMode: (mode: WelcomeMode) => void;
  hide: () => void;
}

export const useWelcomeStore = create<WelcomeStore>((set) => ({
  open: false,
  mode: "quick",
  sessionId: undefined,
  opening: 0,
  show: (options) =>
    set((state) => ({
      open: true,
      mode: options?.mode ?? "quick",
      sessionId: options?.sessionId,
      opening: state.opening + 1,
    })),
  setMode: (mode) => set({ mode }),
  hide: () => set({ open: false }),
}));
