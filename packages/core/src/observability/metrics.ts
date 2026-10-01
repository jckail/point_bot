export type MetricLabels = Readonly<Record<string, string>>;

export const METRIC_TYPES = ["counter", "histogram", "gauge"] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

/** Every metric the platform emits. Add new ones here so docs stay honest. */
export const METRIC_DEFS = {
  http_requests_total: {
    type: "counter",
    help: "HTTP API requests by route template, method and status class.",
  },
  http_request_duration_ms: {
    type: "histogram",
    help: "HTTP API request duration in milliseconds.",
  },
  rate_limited_total: {
    type: "counter",
    help: "Requests rejected by the rate limiter.",
  },
  auth_failures_total: {
    type: "counter",
    help: "Requests rejected for missing/invalid credentials, scope or CSRF.",
  },
  mcp_tool_calls_total: {
    type: "counter",
    help: "MCP tool invocations by tool and outcome (ok|error).",
  },
  use_case_calls_total: {
    type: "counter",
    help: "Application use-case executions by use case and outcome.",
  },
  use_case_duration_ms: {
    type: "histogram",
    help: "Application use-case execution duration in milliseconds.",
  },
  db_ping_latency_ms: {
    type: "gauge",
    help: "Latency of the last readiness database ping in milliseconds.",
  },
} as const satisfies Record<string, { type: MetricType; help: string }>;

export type MetricName = keyof typeof METRIC_DEFS;

export const METRIC_NAMES = Object.fromEntries(
  Object.keys(METRIC_DEFS).map((n) => [n, n]),
) as { readonly [K in MetricName]: K };

/** Metrics port. Implementations must never throw. */
export interface Metrics {
  counter(name: MetricName, labels?: MetricLabels, value?: number): void;
  histogram(name: MetricName, value: number, labels?: MetricLabels): void;
  gauge(name: MetricName, value: number, labels?: MetricLabels): void;
}

export const noopMetrics: Metrics = {
  counter() {},
  histogram() {},
  gauge() {},
};

/** Fan one call out to several backends (e.g. Prometheus text + OTel). */
export function combineMetrics(...targets: readonly Metrics[]): Metrics {
  if (targets.length === 1) return targets[0]!;
  return {
    counter: (n, l, v) => targets.forEach((t) => t.counter(n, l, v)),
    histogram: (n, v, l) => targets.forEach((t) => t.histogram(n, v, l)),
    gauge: (n, v, l) => targets.forEach((t) => t.gauge(n, v, l)),
  };
}

/** "200" -> "2xx". */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

// ─── In-process Prometheus text exposition ─────────────────────────────────

export const DEFAULT_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
] as const;

/** Hard cap on label combinations per metric: a cardinality-explosion guard. */
const MAX_SERIES_PER_METRIC = 500;

interface HistogramSeries {
  buckets: number[];
  sum: number;
  count: number;
}

function labelKey(labels: MetricLabels | undefined): string {
  if (!labels) return "";
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=\u0000${labels[k]}`)
    .join("\u0001");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatLabels(
  labels: MetricLabels | undefined,
  extra?: Record<string, string>,
): string {
  const all = { ...labels, ...extra };
  const keys = Object.keys(all).sort((a, b) =>
    a === "le" ? 1 : b === "le" ? -1 : a.localeCompare(b),
  );
  if (!keys.length) return "";
  return `{${keys.map((k) => `${k}="${escapeLabel(String(all[k]))}"`).join(",")}}`;
}

function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "+Inf" : "-Inf";
  return String(n);
}

/** Small dependency-free registry that renders Prometheus text format 0.0.4. */
export class PrometheusMetrics implements Metrics {
  private readonly counters = new Map<
    MetricName,
    Map<string, { labels: MetricLabels | undefined; value: number }>
  >();
  private readonly gauges = new Map<
    MetricName,
    Map<string, { labels: MetricLabels | undefined; value: number }>
  >();
  private readonly histograms = new Map<
    MetricName,
    Map<string, { labels: MetricLabels | undefined; h: HistogramSeries }>
  >();

  constructor(private readonly buckets: readonly number[] = DEFAULT_BUCKETS_MS) {}

  counter(name: MetricName, labels?: MetricLabels, value = 1): void {
    if (!(value >= 0)) return;
    const series = this.series(this.counters, name);
    const key = labelKey(labels);
    const entry = series.get(key);
    if (entry) entry.value += value;
    else if (series.size < MAX_SERIES_PER_METRIC) series.set(key, { labels, value });
  }

  gauge(name: MetricName, value: number, labels?: MetricLabels): void {
    const series = this.series(this.gauges, name);
    const key = labelKey(labels);
    const entry = series.get(key);
    if (entry) entry.value = value;
    else if (series.size < MAX_SERIES_PER_METRIC) series.set(key, { labels, value });
  }

  histogram(name: MetricName, value: number, labels?: MetricLabels): void {
    if (!Number.isFinite(value)) return;
    const series = this.series(this.histograms, name);
    const key = labelKey(labels);
    let entry = series.get(key);
    if (!entry) {
      if (series.size >= MAX_SERIES_PER_METRIC) return;
      entry = {
        labels,
        h: { buckets: this.buckets.map(() => 0), sum: 0, count: 0 },
      };
      series.set(key, entry);
    }
    this.buckets.forEach((bound, i) => {
      if (value <= bound) entry.h.buckets[i]! += 1;
    });
    entry.h.sum += value;
    entry.h.count += 1;
  }

  private series<T>(store: Map<MetricName, Map<string, T>>, name: MetricName) {
    let s = store.get(name);
    if (!s) store.set(name, (s = new Map()));
    return s;
  }

  /** Prometheus text exposition format. */
  render(): string {
    const out: string[] = [];
    const header = (name: MetricName) => {
      out.push(`# HELP ${name} ${METRIC_DEFS[name].help}`);
      out.push(`# TYPE ${name} ${METRIC_DEFS[name].type}`);
    };
    for (const [name, series] of this.counters) {
      header(name);
      for (const { labels, value } of series.values())
        out.push(`${name}${formatLabels(labels)} ${formatNumber(value)}`);
    }
    for (const [name, series] of this.gauges) {
      header(name);
      for (const { labels, value } of series.values())
        out.push(`${name}${formatLabels(labels)} ${formatNumber(value)}`);
    }
    for (const [name, series] of this.histograms) {
      header(name);
      for (const { labels, h } of series.values()) {
        this.buckets.forEach((bound, i) =>
          out.push(
            `${name}_bucket${formatLabels(labels, { le: String(bound) })} ${h.buckets[i]}`,
          ),
        );
        out.push(`${name}_bucket${formatLabels(labels, { le: "+Inf" })} ${h.count}`);
        out.push(`${name}_sum${formatLabels(labels)} ${formatNumber(h.sum)}`);
        out.push(`${name}_count${formatLabels(labels)} ${h.count}`);
      }
    }
    return out.length ? `${out.join("\n")}\n` : "";
  }
}
