"use client";

import { useEffect, useMemo, useState } from "react";
import { globalSearch, type SearchResult } from "@/services/search/global-search";
import { useSessionStore } from "@/stores/session-store";
import { useSnapshot } from "./use-church-data";

/**
 * Debounced global search, scoped to the active demo role.
 *
 * Pastoral-care records are never searched here: restricted information
 * stays inside the care section.
 */
export function useGlobalSearch(delayMs = 200) {
  const snapshot = useSnapshot();
  const role = useSessionStore((state) => state.role);
  const teamMemberId = useSessionStore((state) => state.teamMemberId);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), delayMs);
    return () => window.clearTimeout(timer);
  }, [query, delayMs]);

  const results = useMemo<SearchResult[]>(
    () => globalSearch(snapshot, debounced, { role, teamMemberId }),
    [snapshot, debounced, role, teamMemberId],
  );

  const grouped = useMemo(() => {
    return results.reduce<Record<string, SearchResult[]>>((acc, result) => {
      (acc[result.kind] ??= []).push(result);
      return acc;
    }, {});
  }, [results]);

  return {
    query,
    setQuery,
    results,
    grouped,
    searching: query !== debounced,
    hasQuery: debounced.trim().length >= 2,
  };
}
