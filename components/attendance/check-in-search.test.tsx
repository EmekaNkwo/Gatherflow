import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { attendance, member, visitor } from "@/tests/factories";
import { CheckInSearch } from "./check-in-search";

vi.mock("@/components/visitors/welcome-button", () => ({
  WelcomeButton: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

const folake = visitor({ id: "p_folake", firstName: "Folake", lastName: "Banda" });
const grace = member();
const here = [{ record: attendance({ id: "r1", personId: "p_folake" }), person: folake }];

function renderSearch() {
  const onCheckIn = vi.fn();
  const onUndo = vi.fn();
  render(
    <CheckInSearch sessionId="s1" people={[folake, grace]} present={here} onCheckIn={onCheckIn} onUndo={onUndo} />,
  );
  return { onCheckIn, onUndo };
}

describe("CheckInSearch (M6)", () => {
  it("shows somebody already checked in as 'Already here' with Undo, not as nobody", async () => {
    const { onUndo, onCheckIn } = renderSearch();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search people to check in" }), "Folake Banda");

    expect(screen.getByText("Already here")).toBeInTheDocument();
    expect(screen.queryByText(/Nobody called/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Welcome someone new/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo check-in for Folake Banda" }));
    expect(onUndo).toHaveBeenCalledWith(here[0]);
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it("checks in somebody not yet here, matching accents and partial words", async () => {
    const { onCheckIn } = renderSearch();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search people to check in" }), "gra ade");
    await userEvent.click(screen.getByRole("button", { name: "Check in Grace Adeyemi" }));
    expect(onCheckIn).toHaveBeenCalledWith(grace);
  });

  it("offers 'Welcome someone new' only when nobody matches at all", async () => {
    renderSearch();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search people to check in" }), "Zebedee");
    expect(screen.getByText(/Nobody called/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Welcome someone new/ })).toBeInTheDocument();
  });
});
