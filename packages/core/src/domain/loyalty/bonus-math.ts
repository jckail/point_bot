/**
 * Applies a bonus with integer math: floor(base * permille / 1000), where
 * `base` is the already-converted destination amount. This is the single
 * definition used by convertPoints and the optimizer. It lives in its own
 * module so the transfer graph and the bonus entity can both depend on it
 * without depending on each other.
 */
export function applyBonusPermille(base: number, permille: number): number {
  return Math.floor((base * permille) / 1000);
}
