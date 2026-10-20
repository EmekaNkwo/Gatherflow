import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/result";
import { freezeTime, lastCommand, resetHarness, seedChurch, transport } from "@/tests/hooks-harness";
import { useChurchStore } from "@/stores/church-store";
import { QuickRegisterForm } from "./quick-register-form";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/visitors/quick",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => freezeTime());
afterEach(resetHarness);

/** The server takes its time, so a second tap lands while the first is in flight. */
function slowServer() {
  let release: () => void = () => {};
  transport.postCommand.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            ok({
              snapshot: useChurchStore.getState().snapshot!,
              notices: [],
              data: { personId: "person_new" },
            }) as never,
          );
      }),
  );
  return () => release();
}

function fillName() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Double" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Clicker" } });
}

describe("QuickRegisterForm (audit H1, H5, L2)", () => {
  it("saves once however many times Add is tapped", async () => {
    seedChurch();
    const release = slowServer();
    render(<QuickRegisterForm />);
    fillName();

    const add = screen.getByRole("button", { name: "Add Double" });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Adding…" }));

    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add them" })).toBeEnabled());
    expect(transport.postCommand).toHaveBeenCalledTimes(1);
  });

  it("saves once when Enter is pressed twice", async () => {
    seedChurch();
    const release = slowServer();
    render(<QuickRegisterForm />);
    fillName();

    const lastName = screen.getByLabelText("Last name");
    fireEvent.keyDown(lastName, { key: "Enter" });
    fireEvent.keyDown(lastName, { key: "Enter" });

    await act(async () => release());
    await waitFor(() => expect(transport.postCommand).toHaveBeenCalledTimes(1));
  });

  it("takes the visit date from the service they are checked in to", async () => {
    const snapshot = seedChurch();
    const session = [...snapshot.sessions].sort((left, right) => (left.date < right.date ? -1 : 1))[0];
    const release = slowServer();
    render(<QuickRegisterForm sessionId={session.id} />);
    fillName();
    fireEvent.click(screen.getByRole("button", { name: "Add Double" }));
    await act(async () => release());

    await waitFor(() => expect(transport.postCommand).toHaveBeenCalled());
    expect(lastCommand().input).toMatchObject({ sessionId: session.id, visitDate: session.date });
  });

  it("stops a name at the server's 80-character limit", () => {
    seedChurch();
    render(<QuickRegisterForm />);
    expect(screen.getByLabelText("First name")).toHaveAttribute("maxLength", "80");
    expect(screen.getByLabelText("Last name")).toHaveAttribute("maxLength", "80");
  });
});
