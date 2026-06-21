/** Material Symbols icon. Name = ligature, e.g. "dashboard", "vpn_key", "add". */
export function Icon({
  name,
  size,
  className,
  fill,
}: {
  name: string;
  size?: number;
  className?: string;
  fill?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined${className ? ` ${className}` : ""}`}
      style={{
        fontSize: size,
        ...(fill ? { fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24' } : {}),
      }}
      aria-hidden
    >
      {name}
    </span>
  );
}
