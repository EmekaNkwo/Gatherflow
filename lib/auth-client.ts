"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser side of Better Auth. Same origin as the application, so no base
 * URL is needed; cookies carry the session.
 */
export const authClient = createAuthClient();
