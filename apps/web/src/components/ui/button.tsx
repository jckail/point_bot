const VARIANTS = {
  primary:
    "bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-strong",
  secondary:
    "border border-brand/40 bg-brand/10 text-brand-soft hover:bg-brand/20",
  ghost: "border border-line text-ink-muted hover:border-ink-faint hover:text-ink",
  danger:
    "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
} as const;

const SIZES = {
  sm: "px-4 py-1.5 text-sm",
  md: "px-6 py-2.5",
  lg: "px-8 py-3",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`cursor-pointer rounded-full font-semibold transition ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    />
  );
}
