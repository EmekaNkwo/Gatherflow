import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectField, type SelectFieldProps } from "./select-field";

const ROLES = [
  { value: "volunteer", label: "Volunteer" },
  { value: "pastor", label: "Pastor" },
  { value: "administrator", label: "Administrator", disabled: true },
];

/** A controlled field, the way every caller uses it. */
function Controlled(props: Omit<SelectFieldProps, "value" | "onValueChange"> & { initial: string; onChange?: (value: string) => void }) {
  const { initial, onChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <SelectField
      {...rest}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("SelectField", () => {
  it("is labelled by its label and shows the chosen option's label, not its value", () => {
    render(<Controlled id="role" label="Role" options={ROLES} initial="pastor" />);
    const trigger = screen.getByRole("combobox", { name: "Role" });
    expect(trigger).toHaveTextContent("Pastor");
    expect(trigger).not.toHaveTextContent("pastor ");
  });

  it("can be labelled without a visible label", () => {
    render(<Controlled aria-label="Role for ada@example.com" options={ROLES} initial="volunteer" />);
    expect(screen.getByRole("combobox", { name: "Role for ada@example.com" })).toHaveTextContent("Volunteer");
  });

  it("reports the chosen value and shows it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled id="role" label="Role" options={ROLES} initial="volunteer" onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Pastor" }));

    expect(onChange).toHaveBeenCalledWith("pastor");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent("Pastor"));
  });

  it("supports an option whose value is empty, such as 'Anyone'", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Controlled
        id="who"
        label="Who"
        options={[{ value: "", label: "Anyone" }, ...ROLES]}
        initial=""
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Who" });
    expect(trigger).toHaveTextContent("Anyone");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Pastor" }));
    expect(onChange).toHaveBeenLastCalledWith("pastor");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Anyone" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    await waitFor(() => expect(trigger).toHaveTextContent("Anyone"));
  });

  it("does not let a disabled option be chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled id="role" label="Role" options={ROLES} initial="volunteer" onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Role" }));
    const disabled = await screen.findByRole("option", { name: "Administrator" });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    await user.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows grouped options under their group's name", async () => {
    const user = userEvent.setup();
    render(
      <Controlled
        id="who"
        label="Who"
        initial=""
        options={[
          { value: "", label: "Nobody yet" },
          { label: "Team", options: [{ value: "tm_1", label: "Grace" }] },
        ]}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Who" }));
    const group = await screen.findByRole("group", { name: "Team" });
    expect(group).toHaveTextContent("Grace");
  });

  it("shows a placeholder when nothing is chosen", () => {
    render(<Controlled id="role" label="Role" placeholder="Choose a role" options={ROLES} initial="" />);
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent("Choose a role");
  });

  it("shows its description and its error next to the field, and marks it invalid", () => {
    render(
      <Controlled
        id="role"
        label="Role"
        description="What they can see."
        error="Choose a role."
        options={ROLES}
        initial=""
      />,
    );
    expect(screen.getByText("What they can see.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a role.");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveAttribute("aria-invalid", "true");
  });

  it("submits its value with a form when given a name", () => {
    const { container } = render(<Controlled id="role" label="Role" name="role" options={ROLES} initial="pastor" />);
    const hidden = container.querySelector<HTMLInputElement>('input[name="role"]');
    expect(hidden?.value).toBe("pastor");
  });

  it("can be disabled as a whole", () => {
    render(<Controlled id="role" label="Role" options={ROLES} initial="pastor" disabled />);
    expect(screen.getByRole("combobox", { name: "Role" })).toBeDisabled();
  });
});
