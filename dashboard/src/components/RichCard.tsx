/**
 * Rich content card — header (title slot + trailing slot), body, optional footer.
 * Borderless — depth from layered shadow + subtle ring, not hard borders.
 */
export function RichCard({
  header,
  footer,
  children,
  className,
}: {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`card flex flex-col rounded-brand-lg hover:shadow-lift${className ? ` ${className}` : ""}`}
    >
      {header && (
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          {header}
        </header>
      )}
      <div className="flex flex-1 flex-col p-4">{children}</div>
      {footer && (
        <footer className="flex items-center justify-between gap-3 border-t border-border-subtle bg-bg-alt px-4 py-2.5 rounded-b-brand-lg">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Title + optional subtitle, for the header slot. */
export function CardTitle({ title, sub, icon }: { title: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {icon}
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold tracking-tight text-text">{title}</div>
        {sub && <div className="truncate text-[12px] text-text-muted">{sub}</div>}
      </div>
    </div>
  );
}
