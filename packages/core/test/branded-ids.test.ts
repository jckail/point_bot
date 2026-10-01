import { describe, expect, expectTypeOf, it } from "vitest";

import { InvalidIdError } from "../src/domain/errors";
import type {
  LoyaltyAccountRepository,
  TripGoalRepository,
} from "../src/domain/loyalty/repositories";
import type { LoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  AccessTokenId,
  AwardWatchId,
  ConsentId,
  EventId,
  LoyaltyAccountId,
  ObservationId,
  ShareId,
  TransferBonusId,
  TripGoalId,
  UserId,
  type Unbrand,
} from "../src/domain/shared";
import { asAccountId, asTripGoalId, asUserId } from "./ids";

const KINDS = {
  UserId,
  LoyaltyAccountId,
  TripGoalId,
  ShareId,
  AwardWatchId,
  AccessTokenId,
  ConsentId,
  ObservationId,
  TransferBonusId,
  EventId,
} as const;

describe("branded ids: runtime (parse at the edge)", () => {
  it.each(Object.entries(KINDS))("%s.parse accepts ids and rejects blanks", (kind, id) => {
    expect(id.parse("some-id")).toBe("some-id");
    expect(id.is("some-id")).toBe(true);
    expect(() => id.parse("")).toThrow(InvalidIdError);
    expect(id.is("")).toBe(false);
    expect(id.is(42)).toBe(false);
    expect(id.kind).toBe(kind);
  });

  it("generate() mints distinct UUIDs for system-created kinds", () => {
    const a = LoyaltyAccountId.generate();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(LoyaltyAccountId.generate()).not.toBe(a);
  });
});

describe("branded ids: compile time (mixing kinds does not typecheck)", () => {
  it("keeps ids distinct from each other and from plain strings", () => {
    const userId = asUserId("u1");
    const accountId = asAccountId("a1");

    expectTypeOf(userId).not.toEqualTypeOf<string>();
    expectTypeOf(userId).toExtend<string>();
    expectTypeOf(userId).not.toExtend<LoyaltyAccountId>();
    expectTypeOf(accountId).not.toExtend<UserId>();
    expectTypeOf<Unbrand<UserId>>().toEqualTypeOf<string>();

    // The classic bug: passing a user id where an account id is expected.
    const accounts = {} as LoyaltyAccountRepository;
    const goals = {} as TripGoalRepository;
    // @ts-expect-error a UserId is not a LoyaltyAccountId
    void (() => accounts.findById(userId));
    // @ts-expect-error a plain string is not a LoyaltyAccountId
    void (() => accounts.findById("a1"));
    // @ts-expect-error an account id is not a TripGoalId
    void (() => goals.findById(accountId));
    // @ts-expect-error an account id is not a UserId
    void (() => accounts.findByUserId(accountId));
    void (() => goals.findById(asTripGoalId("g1")));
    void (() => accounts.findById(accountId));

    // @ts-expect-error entity ids are branded: a plain string is rejected
    const bad: LoyaltyAccount["id"] = "a1";
    void bad;
  });
});
