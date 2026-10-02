import { describe, expect, it } from "vitest";
import { ListProviders, PROVIDER_CATALOG } from "../src/provider-catalog";
import { providerDtoSchema, toProviderDto } from "../src/contracts";
import { providerCapabilities } from "../src/domain/loyalty/provider-capabilities";
import { buildOpenApiDocument } from "../src/contracts/openapi";

describe("public provider capabilities", () => {
  it("publishes official entry paths and conservative balance access for every catalog program", () => {
    const providers = new ListProviders().execute();
    expect(providers).toHaveLength(PROVIDER_CATALOG.length);
    for (const provider of providers) {
      const dto = providerDtoSchema.parse(toProviderDto(provider));
      expect(dto.capabilities).toBeDefined();
      const capabilities = dto.capabilities!;
      const url = new URL(capabilities.officialAccountUrl);
      expect(url.protocol).toBe("https:");
      expect(url.username + url.password).toBe("");
      expect(capabilities.automaticSync).toBe("requires_verified_adapter");
      expect(["not_verified", "partnership_required"]).toContain(capabilities.balanceApiReadiness);
    }
  });
  it("offers reviewed capture only for the existing visible-page reader programs", () => {
    const providers = new ListProviders().execute();
    expect(providers.filter((p) => p.capabilities!.collectionMethods.includes("page_capture")).map((p) => p.id))
      .toEqual(["united", "delta", "american", "marriott", "hilton", "hyatt"]);
    for (const provider of providers.filter((p) => p.capabilities!.collectionMethods.includes("page_capture"))) {
      expect(provider.capabilities!.pageCapture).toBe("review_required");
    }
    expect(providers.find((p) => p.id === "amtrak")!.capabilities!.collectionMethods).toEqual(["manual"]);
    expect(providers.find((p) => p.id === "bilt")!.capabilities!.balanceGuidance).toContain("Bilt Cash");
  });
  it("does not offer numeric points collection for ambiguous Rakuten cash/points payouts", () => {
    const capabilities = new ListProviders().execute().find((p) => p.id === "rakuten")!.capabilities!;
    expect(capabilities.balanceUnit).toBe("ambiguous");
    expect(capabilities.collectionMethods).toEqual([]);
    expect(capabilities.balanceGuidance).toContain("USD cannot be imported as points");
  });
  it("preserves older DTOs and keeps public read-model mutations out of the catalog", () => {
    const provider = new ListProviders().execute()[0]!;
    const { capabilities: _capabilities, ...legacy } = provider;
    expect(_capabilities).toBeDefined();
    expect(providerDtoSchema.safeParse(legacy).success).toBe(true);
    const dto = toProviderDto(provider);
    dto.capabilities!.collectionMethods.splice(0);
    expect(new ListProviders().execute()[0]!.capabilities!.collectionMethods).toEqual(["manual", "page_capture"]);
  });
  it.each(["missing", "toString", "__proto__", "constructor"])("does not inherit capability records for %s", (id) => {
    expect(providerCapabilities(id)).toBeUndefined();
  });
  it("documents capabilities as optional in OpenAPI and describes its readiness enums", () => {
    const doc = buildOpenApiDocument() as { components: { schemas: Record<string, { required?: string[]; properties: Record<string, unknown> }> } };
    expect(doc.components.schemas.ProviderDto!.required).not.toContain("capabilities");
    expect(doc.components.schemas.ProviderDto!.properties).toHaveProperty("capabilities");
    expect(doc.components.schemas.ProviderCapabilitiesDto!.properties).toHaveProperty("balanceApiReadiness");
  });
});
