"use client";

import { useSessionStore } from "@/stores/session-store";

/**
 * Why a section is closed, worded for who is reading. Telling an
 * administrator to "ask an administrator" sends them in a circle: they are
 * told where roles are set instead, and that some areas stay with the people
 * trusted with them whatever the role.
 */
export function RestrictedReason() {
  const role = useSessionStore((state) => state.role);
  return role === "administrator"
    ? "Your role doesn't include this section. Some areas, such as pastoral care, stay with the people trusted with them; other access is set in Settings, under Team."
    : "Your role doesn't include this section. Ask an administrator if you need access.";
}
