/**
 * Nominal ("branded") types over primitives. A `Brand<string, "UserId">` is a
 * string at runtime (zero cost, wire and DB shapes unchanged) but is not
 * assignable from a plain `string` or from another brand, so mixing a
 * `LoyaltyAccountId` with a `UserId` is a compile error.
 *
 * The only way to obtain a branded value from untrusted input is the
 * `parse` function of the matching id kind in ./ids (parse at the edge).
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** The primitive a branded type wraps (`Unbrand<UserId>` = `string`). */
export type Unbrand<T> = T extends string & { readonly __brand: string }
  ? string
  : T extends number & { readonly __brand: string }
    ? number
    : T;
