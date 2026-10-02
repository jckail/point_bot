import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import { HTTP_STATUS_BY_ERROR_CODE, isErrorCode } from "../src/contracts";
import * as errors from "../src/domain/errors";
import {
  DOMAIN_ERROR_CLASSES,
  DomainError,
  TRANSPORT_ERROR_CODES,
  type DomainErrorCode,
  type ErrorCode,
} from "../src/domain/errors";

type ErrorClass = new (...args: string[]) => DomainError;

/** Every exported concrete DomainError subclass of the errors module. */
const exportedErrorClasses = (Object.values(errors) as unknown[]).filter(
  (value): value is ErrorClass =>
    typeof value === "function" && value.prototype instanceof DomainError,
);

const codeOf = (cls: ErrorClass) => new cls("x").code;

describe("error codes", () => {
  it("ErrorCode is a closed literal union, not string", () => {
    expectTypeOf<ErrorCode>().not.toEqualTypeOf<string>();
    expectTypeOf<"PROVIDER_NOT_SUPPORTED">().toExtend<DomainErrorCode>();
    expectTypeOf<"INTERNAL">().toExtend<ErrorCode>();
    expectTypeOf<"NOT_A_CODE">().not.toExtend<ErrorCode>();
  });

  it("registers every exported DomainError subclass", () => {
    expect(exportedErrorClasses.length).toBeGreaterThan(30);
    const registered = new Set<unknown>(DOMAIN_ERROR_CLASSES);
    const missing = exportedErrorClasses
      .filter((cls) => !registered.has(cls))
      .map((cls) => cls.name);
    expect(missing).toEqual([]);
  });

  it("maps every DomainError subclass code to an HTTP status", () => {
    for (const cls of exportedErrorClasses) {
      const code = codeOf(cls);
      expect(HTTP_STATUS_BY_ERROR_CODE, `missing status for ${code}`).toHaveProperty(code);
    }
  });

  it("has no status mapping that no error can produce", () => {
    const producible = new Set<string>([
      ...exportedErrorClasses.map(codeOf),
      ...TRANSPORT_ERROR_CODES,
    ]);
    const orphaned = Object.keys(HTTP_STATUS_BY_ERROR_CODE).filter(
      (code) => !producible.has(code),
    );
    expect(orphaned).toEqual([]);
  });

  it("keeps codes unique across subclasses", () => {
    const codes = exportedErrorClasses.map(codeOf);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("isErrorCode narrows only known codes", () => {
    expect(isErrorCode("REVIEW_STALE")).toBe(true);
    expect(isErrorCode("RATE_LIMITED")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode("SOME_FUTURE_CODE")).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });

  it("docs/api.md lists every code with its HTTP status", () => {
    const docs = readFileSync(
      new URL("../../../docs/api.md", import.meta.url),
      "utf8",
    );
    const rows = new Map<string, number>();
    for (const match of docs.matchAll(/^\| `([A-Z_]+)` \| (\d{3}) \|/gm)) {
      rows.set(match[1]!, Number(match[2]));
    }
    for (const [code, status] of Object.entries(HTTP_STATUS_BY_ERROR_CODE)) {
      expect(rows.get(code), `docs/api.md row for ${code}`).toBe(status);
    }
  });
});
