import type { ButtonHTMLAttributes } from "react";

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

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-brand border border-border bg-bg px-3 py-2 text-[13px] text-text focus:border-accent focus:outline-none transition-colors${className ? ` ${className}` : ""}`}
      {...props}
    />
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
