import { applyBonusPermille } from "./bonus-math";
import { InvalidBalanceError } from "../errors";
import { checkedPointRatio, exactPoints } from "../shared/point-math";
import type { ProviderId } from "./provider";

/**
 * Transfer partner graph: card currencies → airline/hotel programs.
 * Ratios are editorial (1 UR → 1 United mile). Time-boxed transfer bonuses
 * are real data (see transfer-bonus.ts) passed in by the caller; this module
 * never invents any.
 */

export interface TransferEdge {
  readonly fromProviderId: ProviderId;
  readonly toProviderId: ProviderId;
  /** Source points required per destination point (usually 1). */
  readonly ratioFrom: number;
  /** Destination points received per ratioFrom source points (usually 1). */
  readonly ratioTo: number;
  readonly notes?: string;
  /** Minimum source points per transfer, when the program publishes one. */
  readonly minimumSourcePoints?: number;
  /** Source points must be a multiple of this, when published. */
  readonly incrementSourcePoints?: number;
}

/** Rational ratio (destination points per source point) in lowest terms. */
export interface Ratio {
  readonly num: number;
  readonly den: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * Exact rational for an edge: destination = source * num / den. Decimal
 * ratios (1:1.5) are scaled by 1000 and reduced, so all later math is integer.
 */
export function edgeRatio(edge: TransferEdge): Ratio {
  if (!Number.isFinite(edge.ratioTo) || !Number.isFinite(edge.ratioFrom) || edge.ratioTo <= 0 || edge.ratioFrom <= 0) {
    throw new InvalidBalanceError();
  }
  const num = Math.round(edge.ratioTo * 1000);
  const den = Math.round(edge.ratioFrom * 1000);
  exactPoints(num);
  exactPoints(den);
  if (num === 0 || den === 0) throw new InvalidBalanceError();
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** Transfer edges for bank/card currencies (ratios per published programs, reviewed 2026-10). */
export const TRANSFER_EDGES: readonly TransferEdge[] = [
  // chase-ultimate-rewards
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "united", ratioFrom: 1, ratioTo: 1, notes: "Minimum 1,000 points, in 1,000 increments.", minimumSourcePoints: 1_000, incrementSourcePoints: 1_000 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "air-canada-aeroplan", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "aer-lingus-aerclub", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "iberia-plus", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "jetblue-trueblue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "singapore-krisflyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "southwest-rapid-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "virgin-atlantic-flying-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "marriott", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "ihg-one-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "wyndham-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt", ratioFrom: 1, ratioTo: 1, notes: "1:1 for Sapphire Reserve and legacy cardholders; reported 4:3 for newer Sapphire Preferred and Ink Business Preferred accounts from 2026 - verify on your card." },
  // amex-membership-rewards
  { fromProviderId: "amex-membership-rewards", toProviderId: "delta", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "aer-lingus-aerclub", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "air-canada-aeroplan", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "ana-mileage-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "avianca-lifemiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "iberia-plus", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "qantas-frequent-flyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "qatar-privilege-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "singapore-krisflyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "virgin-atlantic-flying-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "marriott", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "choice-privileges", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "cathay-asia-miles", ratioFrom: 5, ratioTo: 4, notes: "Reduced from 1:1 in 2026." },
  { fromProviderId: "amex-membership-rewards", toProviderId: "emirates-skywards", ratioFrom: 5, ratioTo: 4, notes: "Reduced from 1:1 in 2026." },
  { fromProviderId: "amex-membership-rewards", toProviderId: "jetblue-trueblue", ratioFrom: 5, ratioTo: 4, notes: "1,000 MR = 800 TrueBlue points." },
  { fromProviderId: "amex-membership-rewards", toProviderId: "aeromexico-club-premier", ratioFrom: 5, ratioTo: 8, notes: "1 MR = 1.6 Aeromexico points." },
  { fromProviderId: "amex-membership-rewards", toProviderId: "hilton", ratioFrom: 1, ratioTo: 2, notes: "1 MR = 2 Hilton Honors points." },
  // capital-one-miles
  { fromProviderId: "capital-one-miles", toProviderId: "aeromexico-club-premier", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "air-canada-aeroplan", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "avianca-lifemiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "cathay-asia-miles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "etihad-guest", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "finnair-plus", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "qantas-frequent-flyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "qatar-privilege-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "singapore-krisflyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "tap-miles-and-go", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "turkish-miles-and-smiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "choice-privileges", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "wyndham-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "emirates-skywards", ratioFrom: 4, ratioTo: 3 },
  { fromProviderId: "capital-one-miles", toProviderId: "eva-air-infinity-mileagelands", ratioFrom: 4, ratioTo: 3 },
  { fromProviderId: "capital-one-miles", toProviderId: "jal-mileage-bank", ratioFrom: 4, ratioTo: 3 },
  { fromProviderId: "capital-one-miles", toProviderId: "jetblue-trueblue", ratioFrom: 5, ratioTo: 3 },
  { fromProviderId: "capital-one-miles", toProviderId: "preferred-hotels-i-prefer", ratioFrom: 1, ratioTo: 2, notes: "Preferred Hotels & Resorts I Prefer: 1 mile = 2 points." },
  { fromProviderId: "capital-one-miles", toProviderId: "accor-all", ratioFrom: 2, ratioTo: 1, notes: "2 miles = 1 Accor point." },
  // citi-thankyou
  { fromProviderId: "citi-thankyou", toProviderId: "aer-lingus-aerclub", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "american", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "avianca-lifemiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "cathay-asia-miles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "etihad-guest", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "eva-air-infinity-mileagelands", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "jetblue-trueblue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "qantas-frequent-flyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "qatar-privilege-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "singapore-krisflyer", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "thai-royal-orchid-plus", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "turkish-miles-and-smiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "virgin-atlantic-flying-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "wyndham-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "emirates-skywards", ratioFrom: 5, ratioTo: 4, notes: "1 ThankYou = 0.8 Skywards (premium cards)." },
  { fromProviderId: "citi-thankyou", toProviderId: "accor-all", ratioFrom: 2, ratioTo: 1, notes: "2 points = 1 Accor point." },
  { fromProviderId: "citi-thankyou", toProviderId: "choice-privileges", ratioFrom: 1, ratioTo: 1.5, notes: "1 ThankYou = 1.5 Choice points." },
  { fromProviderId: "citi-thankyou", toProviderId: "preferred-hotels-i-prefer", ratioFrom: 1, ratioTo: 2, notes: "Preferred Hotels & Resorts I Prefer: 1:2." },
  // bilt
  { fromProviderId: "bilt", toProviderId: "aer-lingus-aerclub", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "air-canada-aeroplan", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "alaska-atmos-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "avianca-lifemiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "cathay-asia-miles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "emirates-skywards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "etihad-guest", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "iberia-plus", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "jal-mileage-bank", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "qatar-privilege-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "southwest-rapid-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "tap-miles-and-go", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "turkish-miles-and-smiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "united", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "virgin-atlantic-flying-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "hilton", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "ihg-one-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "marriott", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "hyatt", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "wyndham-rewards", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "american", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "accor-all", ratioFrom: 3, ratioTo: 2, notes: "3 Bilt points = 2 Accor points (reported)." },
  { fromProviderId: "bilt", toProviderId: "preferred-hotels-i-prefer", ratioFrom: 1, ratioTo: 2 },
  { fromProviderId: "bilt", toProviderId: "amtrak", ratioFrom: 2, ratioTo: 1, notes: "2 Bilt points = 1 Amtrak Guest Rewards point." },
  // wells-fargo-rewards
  { fromProviderId: "wells-fargo-rewards", toProviderId: "aer-lingus-aerclub", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "avianca-lifemiles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "cathay-asia-miles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "iberia-plus", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "jetblue-trueblue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "virgin-atlantic-flying-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "choice-privileges", ratioFrom: 1, ratioTo: 2, notes: "1 point = 2 Choice points." },
  { fromProviderId: "wells-fargo-rewards", toProviderId: "wyndham-rewards", ratioFrom: 1, ratioTo: 2, notes: "1 point = 2 Wyndham points." },
  // amex-canada-membership-rewards
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "air-canada-aeroplan", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "hilton", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "cathay-asia-miles", ratioFrom: 4, ratioTo: 3 },
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "delta", ratioFrom: 4, ratioTo: 3 },
  { fromProviderId: "amex-canada-membership-rewards", toProviderId: "marriott", ratioFrom: 5, ratioTo: 6, notes: "5 MR = 6 Bonvoy points." },
  // amex-uk-membership-rewards
  { fromProviderId: "amex-uk-membership-rewards", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-uk-membership-rewards", toProviderId: "virgin-atlantic-flying-club", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-uk-membership-rewards", toProviderId: "flying-blue", ratioFrom: 1, ratioTo: 1 },
  // rbc-avion
  { fromProviderId: "rbc-avion", toProviderId: "british-airways-avios", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "rbc-avion", toProviderId: "cathay-asia-miles", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "rbc-avion", toProviderId: "american", ratioFrom: 10, ratioTo: 7, notes: "Minimum 5,000 points, in increments of 10.", minimumSourcePoints: 5_000, incrementSourcePoints: 10 },
];

export function listTransferTargets(fromProviderId: string): TransferEdge[] {
  return TRANSFER_EDGES.filter((edge) => edge.fromProviderId === fromProviderId);
}

export function findTransferEdge(
  fromProviderId: string,
  toProviderId: string,
): TransferEdge | null {
  return (
    TRANSFER_EDGES.find(
      (edge) =>
        edge.fromProviderId === fromProviderId &&
        edge.toProviderId === toProviderId,
    ) ?? null
  );
}

/**
 * Destination points for `sourcePoints` over `edge`, optionally with a bonus
 * (integer permille, 1300 = +30%). Pure integer math: the base conversion is
 * floored, then the bonus is applied and floored again (the optimizer uses
 * this same function, so plans can never disagree with it).
 */
export function convertPoints(
  edge: TransferEdge,
  sourcePoints: number,
  bonusPermille = 1000,
): number {
  exactPoints(sourcePoints);
  exactPoints(bonusPermille);
  const { num, den } = edgeRatio(edge);
  const base = checkedPointRatio(sourcePoints, num, den);
  return applyBonusPermille(base, bonusPermille);
}
