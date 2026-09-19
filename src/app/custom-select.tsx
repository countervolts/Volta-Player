import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
  disabled = false,
  id,
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name. Kept stable so the control is easy to address. */
  label: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;
  const [open, setOpen] = useState(false);
  const describedBy = useId();

  return (
    <>
      {/* The current choice is exposed as the trigger's description rather than
          its name. That keeps the name stable ("Share destination") while a
          screen reader still announces which option is selected. */}
      <span id={describedBy} className="visually-hidden">
        {selectedLabel}
      </span>
      <Dropdown.Root modal={false} open={open} onOpenChange={setOpen}>
        <Dropdown.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            className={`custom-select${className ? ` ${className}` : ""}`}
            aria-label={label}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-describedby={describedBy}
            disabled={disabled}
          >
            <span className="custom-select-value">{selectedLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="custom-select-menu"
            sideOffset={5}
            align="end"
            // A settings list scrolls; letting the menu steal focus would close
            // the dialog the trigger lives in on some browsers.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Dropdown.RadioGroup value={value}>
              {options.map((option) => (
                <Dropdown.RadioItem
                  key={option.value}
                  className="custom-select-option"
                  value={option.value}
                  // `onSelect` fires for both mouse and keyboard, which keeps
                  // the two paths identical.
                  onSelect={() => onChange(option.value)}
                >
                  <span className="custom-select-check" aria-hidden="true">
                    {option.value === value ? <Check size={13} /> : null}
                  </span>
                  {option.label}
                </Dropdown.RadioItem>
              ))}
            </Dropdown.RadioGroup>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </>
  );
}
