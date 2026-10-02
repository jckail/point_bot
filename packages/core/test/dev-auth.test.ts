import { describe, expect, it } from "vitest";

import {
  assertDevAuthAllowed,
  assertValidDevToken,
  InsecureDevAuthError,
  isDevHostAllowed,
  isLoopbackBind,
  parseAuthProvider,
  type DevAuthGuardInput,
} from "../src/dev-auth";

const base: DevAuthGuardInput = {
  provider: "dev",
  nodeEnv: "production",
  allowInsecureDevAuth: undefined,
  bindHost: undefined,
  loopbackOnlyAttested: undefined,
};

describe("parseAuthProvider", () => {
  it("defaults to clerk and accepts dev", () => {
    expect(parseAuthProvider(undefined)).toBe("clerk");
    expect(parseAuthProvider("")).toBe("clerk");
    expect(parseAuthProvider("dev")).toBe("dev");
    expect(parseAuthProvider("CLERK")).toBe("clerk");
  });
  it("rejects typos instead of silently picking a mode", () => {
    expect(() => parseAuthProvider("devv")).toThrow(InsecureDevAuthError);
  });
});

describe("assertDevAuthAllowed", () => {
  it("never restricts clerk mode", () => {
    expect(() => assertDevAuthAllowed({ ...base, provider: "clerk" })).not.toThrow();
  });
  it("allows dev auth outside production", () => {
    expect(() => assertDevAuthAllowed({ ...base, nodeEnv: "development" })).not.toThrow();
    expect(() => assertDevAuthAllowed({ ...base, nodeEnv: "test" })).not.toThrow();
  });
  it("refuses dev auth in production without the explicit opt-in", () => {
    expect(() => assertDevAuthAllowed(base)).toThrow(/ALLOW_INSECURE_DEV_AUTH/);
    expect(() =>
      assertDevAuthAllowed({ ...base, allowInsecureDevAuth: "1", bindHost: "127.0.0.1" }),
    ).toThrow(/ALLOW_INSECURE_DEV_AUTH/);
  });
  it("refuses the opt-in when the host is publicly bound", () => {
    for (const bindHost of [undefined, "0.0.0.0", "::", "10.0.0.5"]) {
      expect(() =>
        assertDevAuthAllowed({ ...base, allowInsecureDevAuth: "true", bindHost }),
      ).toThrow(/non-public bind/);
    }
  });
  it("accepts the opt-in with a loopback bind or a loopback-only attestation", () => {
    expect(() =>
      assertDevAuthAllowed({ ...base, allowInsecureDevAuth: "true", bindHost: "127.0.0.1" }),
    ).not.toThrow();
    expect(() =>
      assertDevAuthAllowed({
        ...base,
        allowInsecureDevAuth: "true",
        bindHost: "0.0.0.0",
        loopbackOnlyAttested: "true",
      }),
    ).not.toThrow();
  });
});

describe("loopback + host helpers", () => {
  it("recognises loopback binds only", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("::1")).toBe(true);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
    expect(isLoopbackBind(undefined)).toBe(false);
  });
  it("matches Host headers by hostname, ignoring ports", () => {
    expect(isDevHostAllowed("localhost:3000")).toBe(true);
    expect(isDevHostAllowed("127.0.0.1:8080")).toBe(true);
    expect(isDevHostAllowed("[::1]:3000")).toBe(true);
    expect(isDevHostAllowed("pointup.example.com")).toBe(false);
    expect(isDevHostAllowed("localhost.evil.com")).toBe(false);
    expect(isDevHostAllowed(null)).toBe(false);
    expect(isDevHostAllowed("web:3000", ["localhost", "web"])).toBe(true);
  });
});

describe("assertValidDevToken", () => {
  it("requires the pu_ prefix and a minimum length", () => {
    expect(() => assertValidDevToken("pu_short")).toThrow();
    expect(() => assertValidDevToken("x".repeat(40))).toThrow();
    expect(() => assertValidDevToken(`pu_${"a".repeat(40)}`)).not.toThrow();
  });
});
