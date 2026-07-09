/** Shared display formatters - one Intl instance each, reused everywhere. */

const numberFormat = new Intl.NumberFormat("en-US");
const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatPoints(points: number): string {
  return numberFormat.format(points);
}

export function formatUsdFromCents(cents: number): string {
  return usdFormat.format(cents / 100);
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
