export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Readonly<
  Record<string, SpanAttributeValue | undefined>
>;

/** What a span callback may do to its own span. */
export interface SpanHandle {
  setAttribute(key: string, value: SpanAttributeValue): void;
  setAttributes(attributes: SpanAttributes): void;
}

export type SpanCallback<T> = (span: SpanHandle) => Promise<T> | T;

/** Tracing port: vendor-neutral, async-context aware. */
export interface Tracer {
  /**
   * Runs `fn` inside a span. Errors are recorded and rethrown unchanged; the
   * span always ends.
   */
  withSpan<T>(
    name: string,
    attributes: SpanAttributes,
    fn: SpanCallback<T>,
  ): Promise<T>;
}

const NOOP_SPAN: SpanHandle = { setAttribute() {}, setAttributes() {} };

/** Zero-overhead default: just calls `fn`. */
export const noopTracer: Tracer = {
  async withSpan(_name, _attributes, fn) {
    return fn(NOOP_SPAN);
  },
};
