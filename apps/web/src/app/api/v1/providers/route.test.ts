import { describe, expect, it, vi } from "vitest";
import { providerDtoSchema } from "@pointup/core/contracts";

// A public catalog must remain readable before server credentials/DB exist.
vi.mock("../../../../server/container", () => { throw new Error("Provider catalog imported the private server container"); });
import { GET } from "./route";

describe("public provider catalog", () => {
  it("returns capabilities without configuring a database or loading server services", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const providers: unknown[] = await response.json();
    expect(providers).toHaveLength(13);
    const parsed = providers.map((provider) => providerDtoSchema.parse(provider));
    expect(parsed.find((provider) => provider.id === "rakuten")?.capabilities?.balanceUnit).toBe("ambiguous");
    expect(parsed.every((provider) => provider.capabilities?.automaticSync === "requires_verified_adapter")).toBe(true);
  });
});
