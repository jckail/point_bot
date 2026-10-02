import { afterEach, expect, it, vi } from "vitest";
import { canonicalApiOrigin, configuredApiOrigin, INVALID_API_URL, LEGACY_API_URL } from "../src/api-origin";
import { loadConfig, saveConfig } from "../src/config";
afterEach(() => vi.unstubAllGlobals());

it.each(["https://pointup.example/dashboard", "https://pointup.example/dashboard/agents", "https://POINTUP.example:443/dashboard"])("explicitly saves pasted page URL %s as the same canonical API origin", async baseUrl => {
  const set = vi.fn();
  vi.stubGlobal("chrome", { storage: { local: { set } } });
  await saveConfig({ baseUrl, token: " pu_test " });
  expect(set).toHaveBeenCalledWith({ baseUrl: "https://pointup.example", token: "pu_test" });
});
it.each(["https://user:password@pointup.example", "https://pointup.example/?token=secret", "https://pointup.example/#secret", "https://pointup.example/?", "https://pointup.example/#", "http://pointup.example", "ftp://pointup.example", "not a URL"])("rejects unsafe new settings without storing them (%s)", async baseUrl => {
  const set = vi.fn();
  vi.stubGlobal("chrome", { storage: { local: { set } } });
  await expect(saveConfig({ baseUrl, token: "pu_test" })).rejects.toThrow(INVALID_API_URL);
  expect(set).not.toHaveBeenCalled();
});
it("keeps loopback development origins and refuses legacy path settings without changing storage", async () => {
  expect(canonicalApiOrigin("http://localhost:3000/dashboard")).toBe("http://localhost:3000");
  expect(configuredApiOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  const value = { baseUrl: "https://pointup.example/dashboard", token: "pu_original" };
  const set = vi.fn();
  vi.stubGlobal("chrome", { storage: { local: { get: async () => value, set } } });
  expect(await loadConfig()).toEqual(value);
  expect(() => configuredApiOrigin(value.baseUrl)).toThrow(LEGACY_API_URL);
  expect(set).not.toHaveBeenCalled();
});
