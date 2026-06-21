import { Icon } from "./Icon";

/**
 * Themed checkbox. Native checkboxes look out of place on the dark Haulix
 * surface, so this is a button styled to match: filled with the accent + a
 * check glyph when on, a bordered box when off. `indeterminate` renders a dash
 * for "some selected" (drives the select-all row).
 */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  className,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border transition-colors ${
        on ? "border-accent bg-accent text-accent-ink" : "border-border bg-bg text-transparent hover:border-text-subtle"
      }${className ? ` ${className}` : ""}`}
    >
      <Icon name={indeterminate ? "remove" : "check"} size={13} />
    </button>
  );
}
