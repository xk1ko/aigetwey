import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { useState, useEffect, useRef, Children, isValidElement } from "react";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink shadow-warm hover:bg-accent-hover border border-transparent font-semibold",
  ghost: "bg-transparent text-text-muted border border-border hover:text-text hover:border-text-subtle",
  danger: "bg-transparent text-text-muted border border-border hover:text-danger hover:border-danger/50",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-brand px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${VARIANTS[variant]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-brand border border-border bg-bg px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none transition-colors${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export function Select({
  className,
  value,
  onChange,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const options: { value: string; label: string }[] = [];
  Children.forEach(children as ReactNode, (child) => {
    if (isValidElement(child) && child.type === "option") {
      const el = child as ReactElement<{ value?: string; children?: ReactNode }>;
      let label: string;
      if (typeof el.props.children === "string") {
        label = el.props.children;
      } else if (Array.isArray(el.props.children)) {
        label = el.props.children.map((c) => (c == null ? "" : String(c))).join("");
      } else {
        label = String(el.props.value ?? "");
      }
      options.push({ value: String(el.props.value ?? ""), label });
    }
  });

  const selected = options.find((o) => o.value === String(value ?? ""));
  const display = selected?.label ?? "";

  return (
    <div className={`relative${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-brand border border-border bg-bg px-3 py-2 text-left text-[13px] text-text transition-colors focus:border-accent focus:outline-none"
      >
        <span className="truncate">{display}</span>
        <svg className={`ml-2 h-4 w-4 shrink-0 text-text-subtle transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-brand border border-border bg-surface shadow-lg">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange?.({ target: { value: o.value } } as React.ChangeEvent<HTMLSelectElement>);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors ${
                o.value === String(value ?? "") ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
        {label}
        {hint && <span className="ml-1.5 lowercase tracking-normal text-text-subtle/70">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
