import { describe, expect, it } from "vitest";
import { httpStatusForErrorCode } from "../src/contracts/index";
import { agentObservationDtoSchema, observationResultDtoSchema, submitObservationRequestSchema } from "../src/contracts/agent";
import { buildOpenApiDocument } from "../src/contracts/openapi";
import { ObservationReplayConflictError } from "../src/domain/errors";

const legacy = { skillId: "synthetic", points: 42, sourceUrl: "https://provider.test/points" };
const captureId = "123e4567-e89b-42d3-a456-426614174000";
describe("additive observation wire", () => {
  it("accepts legacy claims and both self-reported capture methods", () => {
    expect(submitObservationRequestSchema.parse(legacy).agent).toBe("unknown");
    for (const sourceMethod of ["page_capture", "manual_entry"]) {
      expect(submitObservationRequestSchema.parse({ ...legacy, captureId, sourceMethod })).toMatchObject({ captureId, sourceMethod });
    }
  });
  it.each([{ captureId: "invalid" }, { sourceMethod: "unknown" }, { userId: "forged" }, { credentialKind: "session" }, { tokenId: "forged" }, { consentId: "forged" }, { payloadHash: "forged" }])("excludes forged or malformed claims %j", fields => {
    expect(submitObservationRequestSchema.safeParse({ ...legacy, ...fields }).success).toBe(false);
  });
  it.each(["recorded", "unchanged", "needs_review", "rejected"])("retains %s and optional receipt identity", outcome => {
    const result = { outcome, accountId: "account-one", points: 42, previousPoints: null, message: "Synthetic receipt", reviewId: outcome === "needs_review" ? "review-one" : null };
    expect(observationResultDtoSchema.parse(result)).toEqual(result);
    expect(observationResultDtoSchema.parse({ ...result, observationId: "receipt-one" })).toEqual({ ...result, observationId: "receipt-one" });
  });
  it("maps the closed replay-conflict code to 409", () => {
    expect(httpStatusForErrorCode(new ObservationReplayConflictError().code)).toBe(409);
  });
  it("publishes additions without private provenance fields or agent review authority", () => {
    const document = JSON.stringify(buildOpenApiDocument());
    expect(document).toContain('"captureId"');
    expect(document).toContain('"sourceMethod"');
    expect(document).toContain('"observationId"');
    expect(document).toContain("OBSERVATION_REPLAY_CONFLICT");
    expect(document).toContain("Observation JSON exceeds 32 KiB");
    expect(document).toContain('"x-pointup-session-only":true');
    for (const key of ["accessTokenId", "payloadHash", "consentId", "credentialKind"]) {
      expect(Object.keys(agentObservationDtoSchema.shape)).not.toContain(key);
    }
  });
});
