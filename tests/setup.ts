import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Most suites run in jsdom. The database integration tests declare the node
 * environment instead, where there is no `window` to reset — so the browser
 * cleanup is applied only where a browser exists.
 */
const isBrowserLike = typeof window !== "undefined";

beforeEach(() => {
  if (isBrowserLike) window.localStorage.clear();
});

afterEach(() => {
  if (isBrowserLike) {
    cleanup();
    window.localStorage.clear();
  }
});
