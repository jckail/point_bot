import {
  PROVIDER_KIND_LABELS,
  type ProviderKind,
} from "@pointup/core/providers";

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M10.5 13.5 4 11l1.5-1.5 5.5 1 4.5-4.5c.6-.6 1.6-.6 2.2 0 .6.6.6 1.6 0 2.2L13 12.5l1 5.5L12.5 19.5 10 13.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 9h3.5A1.5 1.5 0 0 1 20 10.5V20M3 20h19M8 8h2M8 12h2M8 16h2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M3 10h18M6.5 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <rect
        x="6"
        y="4"
        width="12"
        height="12"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 16 6 20M15.5 16l2.5 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M5.5 8h13l-1 12h-11l-1-12ZM8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const KIND_ICONS: Record<ProviderKind, () => React.ReactNode> = {
  airline: PlaneIcon,
  hotel: BuildingIcon,
  credit_card: CardIcon,
  rail: TrainIcon,
  shopping: BagIcon,
};

export function ProviderBadge({ kind }: { kind: ProviderKind }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-midnight px-2.5 py-1 text-xs font-medium text-ink-muted">
      <Icon />
      {PROVIDER_KIND_LABELS[kind]}
    </span>
  );
}
