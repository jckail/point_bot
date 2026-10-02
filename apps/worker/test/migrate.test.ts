import { runLockedMigrations, type MigrationAttestation } from "@pointup/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/jobs/migrate";

vi.mock("@pointup/core", () => ({ runLockedMigrations: vi.fn() }));
const attestation: MigrationAttestation = { component: "pointup_migrations", event: "journal_verified", manifestSha256: "a".repeat(64), migrationCount: 21, schemaVerified: true };
beforeEach(() => { vi.mocked(runLockedMigrations).mockReset(); vi.stubEnv("EXPECTED_MIGRATION_MANIFEST_SHA256", undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("migration worker candidate gate", () => {
  it("passes the candidate digest and waits for safe stdout attestation before done", async () => {
    vi.stubEnv("EXPECTED_MIGRATION_MANIFEST_SHA256", attestation.manifestSha256);
    vi.stubEnv("MIGRATIONS_DIR", "/private/baked/path");
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation(line => { lines.push(String(line)); });
    let flush: (() => void) | undefined;
    vi.spyOn(process.stdout, "write").mockImplementation((...args: Parameters<typeof process.stdout.write>) => {
      lines.push(String(args[0]));
      const callback = args[args.length - 1];
      if (typeof callback === "function") flush = () => callback();
      return true;
    });
    vi.mocked(runLockedMigrations).mockImplementationOnce(async (_url, _config, options) => {
      expect(options?.expectedManifestSha256).toBe(attestation.manifestSha256);
      expect(options?.verifyApplicationSchema).toBe(true);
      await options?.onAttested?.(attestation);
      return attestation;
    });
    const running = runMigrations("postgresql://private:password@localhost/app");
    expect(lines).toEqual(["[migrate] applying managed migrations", JSON.stringify(attestation) + "\n"]);
    expect(flush).toBeDefined();
    flush!();
    await running;
    expect(lines.at(-1)).toBe("[migrate] done");
    expect(lines.join("\n")).not.toContain("private");
  });
  it("keeps ordinary local migration optional without certifying a journal", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(runLockedMigrations).mockResolvedValueOnce(undefined);
    await runMigrations("postgresql://localhost/app");
    expect(vi.mocked(runLockedMigrations).mock.calls[0]?.[2]?.expectedManifestSha256).toBeUndefined();
    expect(log).toHaveBeenLastCalledWith("[migrate] done");
  });
  it("fails safely when the database gate fails, without logging private driver errors", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(runLockedMigrations).mockRejectedValueOnce(new Error("private-password and private SQL"));
    await expect(runMigrations("postgresql://localhost/app")).rejects.toThrow("Managed migration task failed; verify candidate manifest and database journal.");
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("does not finish when the attestation output cannot flush", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation((...args: Parameters<typeof process.stdout.write>) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") callback(new Error("private transport detail"));
      return false;
    });
    vi.mocked(runLockedMigrations).mockImplementationOnce(async (_url, _config, options) => {
      await options?.onAttested?.(attestation);
      return attestation;
    });
    await expect(runMigrations("postgresql://localhost/app")).rejects.toThrow("Managed migration task failed");
    expect(log).toHaveBeenCalledTimes(1);
  });
});
