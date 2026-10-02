import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalApiOrigin, configuredApiOrigin } from "../src/api-origin";

const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")) as {
  host_permissions: string[];
};

it.each(["localhost", "127.0.0.1", "[::1]"])("declares the exact HTTP host accepted for %s at development ports", host => {
  // Chrome match patterns without a port grant all ports for that exact host.
  expect(manifest.host_permissions).toContain(`http://${host}/*`);
  for (const port of [80, 3000, 55443]) {
    const origin = new URL(`http://${host}:${port}`).origin;
    expect(canonicalApiOrigin(`${origin}/dashboard/agents`)).toBe(origin);
    expect(configuredApiOrigin(`${origin}/`)).toBe(origin);
  }
});

it("keeps HTTP grants bounded to the supported loopback hosts", () => {
  expect(manifest.host_permissions.filter(pattern => pattern.startsWith("http://")).sort())
    .toEqual(["http://127.0.0.1/*", "http://[::1]/*", "http://localhost/*"].sort());
  for (const host of ["localhost.example", "127.0.0.2", "[::2]", "192.168.1.1", "pointup.example"]) {
    expect(() => canonicalApiOrigin(`http://${host}:3000`)).toThrow();
  }
});
