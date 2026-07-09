const gradientStops = (
  <>
    <stop offset="0" stopColor="#7C5CFF" />
    <stop offset="0.55" stopColor="#A78BFA" />
    <stop offset="1" stopColor="#FFB547" />
  </>
);

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <linearGradient
          id="pu-mark"
          gradientUnits="userSpaceOnUse"
          x1="60"
          y1="200"
          x2="200"
          y2="56"
        >
          {gradientStops}
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="60" className="fill-surface-raised" />
      <circle cx="76" cy="182" r="13" fill="url(#pu-mark)" />
      <circle cx="110" cy="148" r="16" fill="url(#pu-mark)" />
      <circle cx="144" cy="114" r="19" fill="url(#pu-mark)" />
      <path d="M140 60 h58 v58 z" fill="url(#pu-mark)" />
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span
        className="font-display font-bold tracking-tight text-ink"
        style={{ fontSize: size * 0.7 }}
      >
        Point<span className="text-brand">Up</span>
      </span>
    </span>
  );
}
