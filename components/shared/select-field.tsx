"use client";

import { useId, type ReactNode } from "react";
import { cn } from "cn";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The one select in GatherFlow: shadcn's Select (Base UI underneath) with
 * the label, description and error every field has, a 44px trigger a thumb
 * can hit, and the chosen option's label — never its raw value — in the
 * trigger.
 *
 * Values are strings. An empty string is an ordinary value, so options such
 * as "Anyone" or "Nobody yet" are written `{ value: "", label: "Anyone" }`.
 * With react-hook-form, bind it through `Controller`:
 *
 *   <Controller control={form.control} name="source" render={({ field }) => (
 *     <SelectField id="source" label="How they found us" value={field.value}
 *       onValueChange={field.onChange} options={SOURCE_OPTIONS} />
 *   )} />
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: readonly SelectOption[];
}

export type SelectOptions = readonly (SelectOption | SelectOptionGroup)[];

export interface SelectFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOptions;
  /** The trigger's id; the label points at it. Generated when omitted. */
  id?: string;
  /** A visible label. Without one, give `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  description?: ReactNode;
  /** Shown under the field, and marks it invalid. */
  error?: string | null;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Submits the value with a surrounding form under this name. */
  name?: string;
  /** Classes for the wrapping field (or the trigger, when there is no label). */
  className?: string;
  /** Classes for the trigger, e.g. `rounded-full` for a filter pill. */
  triggerClassName?: string;
}

function isGroup(entry: SelectOption | SelectOptionGroup): entry is SelectOptionGroup {
  return "options" in entry;
}

export function flattenOptions(options: SelectOptions): SelectOption[] {
  return options.flatMap((entry) => (isGroup(entry) ? [...entry.options] : [entry]));
}

export function SelectField({
  value,
  onValueChange,
  options,
  id,
  label,
  "aria-label": ariaLabel,
  description,
  error,
  placeholder,
  disabled,
  required,
  name,
  className,
  triggerClassName,
}: SelectFieldProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const describedBy = [description ? `${triggerId}-description` : null, error ? `${triggerId}-error` : null]
    .filter(Boolean)
    .join(" ");
  const items = flattenOptions(options).map((option) => ({ value: option.value, label: option.label }));

  const select = (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(typeof next === "string" ? next : "")}
      items={items}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectTrigger
        id={triggerId}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "min-h-11 w-full rounded-xl bg-card px-3.5 text-base data-[size=default]:h-auto",
          !label && className,
          triggerClassName,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((entry) =>
          isGroup(entry) ? (
            <SelectGroup key={`group:${entry.label}`}>
              <SelectLabel>{entry.label}</SelectLabel>
              {entry.options.map((option) => (
                <OptionItem key={option.value} option={option} />
              ))}
            </SelectGroup>
          ) : (
            <OptionItem key={entry.value} option={entry} />
          ),
        )}
      </SelectContent>
    </Select>
  );

  if (!label) return select;

  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={triggerId}>{label}</FieldLabel>
      {select}
      {description ? <FieldDescription id={`${triggerId}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${triggerId}-error`}>{error}</FieldError> : null}
    </Field>
  );
}

function OptionItem({ option }: { option: SelectOption }) {
  return (
    <SelectItem value={option.value} disabled={option.disabled} className="min-h-11 text-base">
      {option.label}
    </SelectItem>
  );
}
