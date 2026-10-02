import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfig } from "../src/config";
let local: Record<string, unknown>;
let session: Record<string, unknown>;
const accessLevel = vi.fn();
beforeEach(() => {
  local = {}; session = {}; accessLevel.mockClear();
  const area = (values: Record<string, unknown>) => ({
    get: async () => ({ ...values }),
    set: async (patch: Record<string, unknown>) => { Object.assign(values, patch); },
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    setAccessLevel: accessLevel,
  });
  vi.stubGlobal("chrome", { storage: { local: area(local), session: area(session) } });
});
describe("extension token storage consent", () => {
  it("defaults to session-only PAT storage and trusted local access", async () => {
    await saveConfig({ baseUrl: "https://pointup.test", token: "pu_secret" });
    expect(local).toEqual({ baseUrl: "https://pointup.test" });
    expect(session.token).toBe("pu_secret"); expect((await loadConfig()).rememberToken).toBe(false);
    expect(accessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });
  it("remembers PATs only with explicit consent, and forgets them when unchecked", async () => {
    await saveConfig({ baseUrl: "https://pointup.test", token: "pu_secret", rememberToken: true });
    delete session.token;
    expect(await loadConfig()).toMatchObject({ token: "pu_secret", rememberToken: true });
    await saveConfig({ baseUrl: "https://pointup.test", token: "", rememberToken: false });
    expect(local).not.toHaveProperty("agentToken"); expect((await loadConfig()).token).toBe("");
  });
  it("refuses to persist Clerk session credentials and removes legacy persisted secrets", async () => {
    await expect(saveConfig({ baseUrl: "https://pointup.test", token: "clerk-session", rememberToken: true })).rejects.toThrow("Only PointUp");
    local.token = "legacy-secret"; local.latestCapture = { private: true };
    await loadConfig(); expect(local).not.toHaveProperty("token"); expect(local).not.toHaveProperty("latestCapture");
  });
  it("clears conversation and pending submissions when credentials change", async () => {
    session.assistantChat = ["private"]; session.pendingObservation = { id: "pending" };
    await saveConfig({ baseUrl: "https://pointup.test", token: "pu_next" });
    expect(session).not.toHaveProperty("assistantChat"); expect(session).not.toHaveProperty("pendingObservation");
    expect(session.latestCapture).toBeNull();
  });
});
