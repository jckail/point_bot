import { afterEach, describe, expect, it } from "vitest";

import {
  LOG_LEVELS,
  METRIC_NAMES,
  PrometheusMetrics,
  REDACTED,
  combineMetrics,
  configureObservability,
  createConsoleLogger,
  createObservability,
  createOtelTracer,
  getRequestContext,
  noopLogger,
  noopMetrics,
  noopTracer,
  otelConfigured,
  redact,
  resetObservability,
  resolveRequestId,
  runWithRequestContext,
  statusClass,
  traced,
  tracedAll,
  withSpan,
  type Observability,
  type SpanAttributes,
  type SpanHandle,
  type Tracer,
} from "../src/observability";

const PAT = "pu_abcdefghijklmnopqrstuvwxyz0123456789";

function capture(level: (typeof LOG_LEVELS)[number] = "debug") {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const logger = createConsoleLogger({
    level,
    write: (line) => {
      raw.push(line);
      lines.push(JSON.parse(line));
    },
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  return { logger, lines, raw };
}

describe("redaction", () => {
  it("masks sensitive keys at any depth, including arrays", () => {
    const out = redact({
      authorization: "Bearer abc",
      nested: { password: "hunter2", ok: "fine", deeper: [{ apiKey: "k", cookie: "c" }] },
      clientSecret: "s",
      token: "t",
    }) as { authorization: string; token: string; clientSecret: string; nested: { password: string; ok: string; deeper: Record<string, string>[] } };
    expect(out.authorization).toBe(REDACTED);
    expect(out.nested.password).toBe(REDACTED);
    expect(out.nested.ok).toBe("fine");
    expect(out.nested.deeper[0]).toEqual({ apiKey: REDACTED, cookie: REDACTED });
    expect(out.clientSecret).toBe(REDACTED);
    expect(out.token).toBe(REDACTED);
  });

  it("scrubs pu_ tokens and Bearer values inside free-form strings", () => {
    const out = redact({
      note: `called with ${PAT} ok`,
      header: "Bearer eyJhbGciOi.payload.sig",
    }) as Record<string, string>;
    expect(out.note).toBe(`called with ${REDACTED} ok`);
    expect(out.header).toBe(`Bearer ${REDACTED}`);
    expect(JSON.stringify(out)).not.toContain(PAT);
  });

  it("keeps short pu_ lookalikes and token ids", () => {
    const out = redact({ tokenId: "tok_1", msg: "pu_short" }) as Record<string, string>;
    expect(out).toEqual({ tokenId: "tok_1", msg: "pu_short" });
  });

  it("serialises Error objects (message, stack, cause) with secrets removed", () => {
    const err = new Error(`failed for ${PAT}`, { cause: new Error("Bearer abc.def") });
    const out = redact(err) as { name: string; message: string; stack: string; cause: { message: string } };
    expect(out.name).toBe("Error");
    expect(out.message).toBe(`failed for ${REDACTED}`);
    expect(out.stack).not.toContain(PAT);
    expect(out.cause.message).toBe(`Bearer ${REDACTED}`);
  });

  it("survives cycles and extreme depth", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect((redact(a) as { self: string }).self).toBe("[Circular]");
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i++) deep = deep.n = {};
    expect(JSON.stringify(redact(root))).toContain("[Truncated]");
  });
});

describe("console logger", () => {
  it("writes one redacted JSON line with level, time and bindings", () => {
    const { logger, lines, raw } = capture();
    logger
      .child({ service: "svc" })
      .info(`hello ${PAT}`, { authorization: `Bearer ${PAT}`, route: "/x", error: new Error("boom") });
    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toContain(PAT);
    expect(lines[0]).toMatchObject({
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      msg: `hello ${REDACTED}`,
      service: "svc",
      route: "/x",
      authorization: REDACTED,
      error: { name: "Error", message: "boom" },
    });
  });

  it("filters below the minimum level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("adds the ambient requestId and never throws", () => {
    const { logger, lines } = capture();
    runWithRequestContext({ requestId: "req-12345678" }, () => logger.info("in ctx"));
    logger.info("outside");
    expect(lines[0]!.requestId).toBe("req-12345678");
    expect(lines[1]).not.toHaveProperty("requestId");
    const broken = createConsoleLogger({
      write: () => {
        throw new Error("sink down");
      },
    });
    expect(() => broken.info("x")).not.toThrow();
    expect(() => noopLogger.error("x")).not.toThrow();
  });
});

describe("request id", () => {
  it("accepts well-formed inbound ids and mints otherwise", () => {
    expect(resolveRequestId("abc-12345678")).toBe("abc-12345678");
    const minted = resolveRequestId(undefined);
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId("short")).not.toBe("short");
    expect(resolveRequestId("evil\nid-12345678")).not.toContain("evil");
    expect(resolveRequestId("x".repeat(200))).toHaveLength(36);
  });

  it("propagates through async boundaries", async () => {
    const seen = await runWithRequestContext({ requestId: "req-async-1" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getRequestContext()?.requestId;
    });
    expect(seen).toBe("req-async-1");
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("prometheus metrics", () => {
  it("renders counters, gauges and histograms in text format", () => {
    const m = new PrometheusMetrics([10, 100]);
    m.counter("http_requests_total", { route: "/a", method: "GET", status_class: "2xx" });
    m.counter("http_requests_total", { method: "GET", route: "/a", status_class: "2xx" }, 2);
    m.gauge("db_ping_latency_ms", 3.5);
    m.histogram("http_request_duration_ms", 5, { route: "/a" });
    m.histogram("http_request_duration_ms", 50, { route: "/a" });
    m.histogram("http_request_duration_ms", 500, { route: "/a" });
    const text = m.render();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain('http_requests_total{method="GET",route="/a",status_class="2xx"} 3');
    expect(text).toContain("# TYPE db_ping_latency_ms gauge");
    expect(text).toContain("db_ping_latency_ms 3.5");
    expect(text).toContain('http_request_duration_ms_bucket{route="/a",le="10"} 1');
    expect(text).toContain('http_request_duration_ms_bucket{route="/a",le="100"} 2');
    expect(text).toContain('http_request_duration_ms_bucket{route="/a",le="+Inf"} 3');
    expect(text).toContain('http_request_duration_ms_sum{route="/a"} 555');
    expect(text).toContain('http_request_duration_ms_count{route="/a"} 3');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values and ignores negative counters", () => {
    const m = new PrometheusMetrics();
    m.counter("rate_limited_total", { class: 'a"b\\c\nd' });
    m.counter("rate_limited_total", { class: "x" }, -1);
    const text = m.render();
    expect(text).toContain('rate_limited_total{class="a\\"b\\\\c\\nd"} 1');
    expect(text).not.toContain('class="x"');
  });

  it("caps label cardinality per metric", () => {
    const m = new PrometheusMetrics();
    for (let i = 0; i < 700; i++) m.counter("http_requests_total", { route: `/r${i}` });
    expect(m.render().split("\n").filter((l) => l.startsWith("http_requests_total{"))).toHaveLength(500);
  });

  it("is empty before anything is recorded; helpers behave", () => {
    expect(new PrometheusMetrics().render()).toBe("");
    expect(statusClass(404)).toBe("4xx");
    expect(METRIC_NAMES.mcp_tool_calls_total).toBe("mcp_tool_calls_total");
    const a = new PrometheusMetrics();
    const b = new PrometheusMetrics();
    combineMetrics(a, b, noopMetrics).counter("rate_limited_total", {});
    expect(a.render()).toBe(b.render());
  });
});

class FakeTracer implements Tracer {
  readonly spans: { name: string; attrs: Record<string, unknown>; error?: unknown }[] = [];
  async withSpan<T>(
    name: string,
    attributes: SpanAttributes,
    fn: (span: SpanHandle) => Promise<T> | T,
  ): Promise<T> {
    const record = { name, attrs: { ...attributes } } as (typeof this.spans)[number];
    this.spans.push(record);
    try {
      return await fn({
        setAttribute: (k, v) => void (record.attrs[k] = v),
        setAttributes: (a) => void Object.assign(record.attrs, a),
      });
    } catch (error) {
      record.error = error;
      throw error;
    }
  }
}

function install(): { tracer: FakeTracer; metrics: PrometheusMetrics } {
  const tracer = new FakeTracer();
  const metrics = new PrometheusMetrics();
  const obs: Observability = { logger: noopLogger, tracer, metrics, prometheus: metrics };
  configureObservability(obs);
  return { tracer, metrics };
}

describe("traced()", () => {
  afterEach(() => resetObservability());

  class Greeter {
    readonly greeting = "hi";
    async execute(name: string): Promise<string> {
      return `${this.greeting} ${name}`;
    }
    helper() {
      return this.greeting;
    }
  }

  it("wraps execute: span, result, metrics; preserves this and other members", async () => {
    const { tracer, metrics } = install();
    const uc = traced("greet", new Greeter());
    await expect(uc.execute("bob")).resolves.toBe("hi bob");
    expect(uc.helper()).toBe("hi");
    expect(uc.greeting).toBe("hi");
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]).toMatchObject({
      name: "usecase.greet",
      attrs: { "usecase.name": "greet", "usecase.outcome": "ok" },
    });
    const text = metrics.render();
    expect(text).toContain('use_case_calls_total{outcome="ok",use_case="greet"} 1');
    expect(text).toContain('use_case_duration_ms_count{use_case="greet"} 1');
  });

  it("rethrows the original error and records outcome and code", async () => {
    const { tracer, metrics } = install();
    const failure = Object.assign(new Error("nope"), { code: "ACCOUNT_NOT_FOUND" });
    const uc = traced("fail", {
      execute: async () => {
        throw failure;
      },
    });
    await expect(uc.execute()).rejects.toBe(failure);
    expect(tracer.spans[0]!.attrs).toMatchObject({
      "usecase.outcome": "error",
      "error.code": "ACCOUNT_NOT_FOUND",
    });
    expect(tracer.spans[0]!.error).toBe(failure);
    expect(metrics.render()).toContain('use_case_calls_total{outcome="error",use_case="fail"} 1');
  });

  it("never records arguments or results", async () => {
    const { tracer } = install();
    await traced("secret", { execute: async (token: string) => token }).execute(PAT);
    expect(JSON.stringify(tracer.spans)).not.toContain(PAT);
  });

  it("resolves telemetry per call, so wrapping before configuration works", async () => {
    const uc = traced("late", { execute: async () => 1 });
    await expect(uc.execute()).resolves.toBe(1); // noop backend
    const { tracer } = install();
    await uc.execute();
    expect(tracer.spans).toHaveLength(1);
  });

  it("tracedAll wraps only entries with execute, keyed by name", async () => {
    const { tracer } = install();
    const mod = tracedAll({
      getThing: { execute: async () => "x" },
      plain: { value: 1 },
      fn: () => 2,
    });
    await mod.getThing.execute();
    expect(mod.plain.value).toBe(1);
    expect(mod.fn()).toBe(2);
    expect(tracer.spans.map((s) => s.name)).toEqual(["usecase.getThing"]);
  });
});

describe("tracer helpers and wiring", () => {
  afterEach(() => resetObservability());

  it("withSpan uses the configured tracer; the default is a no-op", async () => {
    await expect(withSpan("a", {}, () => 7)).resolves.toBe(7);
    const { tracer } = install();
    await withSpan("b", { k: 1, skip: undefined }, (s) => s.setAttribute("x", true));
    expect(tracer.spans[0]).toMatchObject({ name: "b", attrs: { k: 1, x: true } });
    await expect(noopTracer.withSpan("n", {}, () => 1)).resolves.toBe(1);
  });

  it("OTel adapter without an SDK is a transparent pass-through", async () => {
    const t = createOtelTracer();
    await expect(t.withSpan("s", { a: 1 }, async () => "ok")).resolves.toBe("ok");
    const boom = new Error("x");
    await expect(
      t.withSpan("s", {}, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("createObservability stays on no-op tracing without an OTLP endpoint", () => {
    expect(otelConfigured({})).toBe(false);
    expect(otelConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318" })).toBe(true);
    const obs = createObservability({ service: "t", env: {} });
    expect(obs.tracer).toBe(noopTracer);
    expect(obs.metrics).toBe(obs.prometheus);
  });
});
