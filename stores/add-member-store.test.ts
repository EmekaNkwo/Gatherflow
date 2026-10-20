import { beforeEach, describe, expect, it } from "vitest";
import { useAddMemberStore } from "./add-member-store";

describe("add-member store", () => {
  beforeEach(() => useAddMemberStore.getState().hide());

  it("opens and closes", () => {
    useAddMemberStore.getState().show();
    expect(useAddMemberStore.getState().open).toBe(true);
    useAddMemberStore.getState().hide();
    expect(useAddMemberStore.getState().open).toBe(false);
  });

  it("starts afresh every time it opens", () => {
    useAddMemberStore.getState().show();
    const first = useAddMemberStore.getState().opening;
    useAddMemberStore.getState().hide();
    useAddMemberStore.getState().show();
    expect(useAddMemberStore.getState().opening).toBeGreaterThan(first);
  });
});
