import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceExtras } from "./service-extras";

describe("ServiceExtras (L1)", () => {
  it("opens this church's own welcome page for QR check-in", () => {
    render(
      <ServiceExtras
        canEdit
        churchId="church_42"
        initialNotes=""
        removed={[]}
        onImport={vi.fn()}
        onRestore={vi.fn()}
        onSaveNotes={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /QR check-in/ })).toHaveAttribute("href", "/connect/church_42");
  });
});
