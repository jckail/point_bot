/**
 * Curated award "sweet spots" / redemption patterns.
 *
 * HONESTY CONTRACT. This is editorial knowledge, not live data:
 *  - every entry is `verified: false` and carries a confidence of "medium" or
 *    "low" (nothing here is "high": award charts change without notice);
 *  - costs are TYPICAL ranges, never live prices or availability;
 *  - cash values are rough typical retail prices used only to derive an
 *    estimated cents-per-point; they are not quotes;
 *  - the optimizer repeats these caveats on every plan it builds.
 * Re-review the whole file before relying on it (`lastReviewed`).
 */

export const SWEET_SPOT_KINDS = ["flight", "hotel", "other"] as const;
export type SweetSpotKind = (typeof SWEET_SPOT_KINDS)[number];

/** What one `pointsCost` buys. */
export const SWEET_SPOT_UNITS = [
  "night",
  "one_way",
  "round_trip",
  "stay",
  "redemption",
] as const;
export type SweetSpotUnit = (typeof SWEET_SPOT_UNITS)[number];

export const SWEET_SPOT_CONFIDENCE = ["high", "medium", "low"] as const;
export type SweetSpotConfidence = (typeof SWEET_SPOT_CONFIDENCE)[number];

export const SWEET_SPOT_REVIEW_DATE = "2026-10-01";

export interface SweetSpot {
  readonly id: string;
  /** Provider (catalog id) whose points are spent on this redemption. */
  readonly programId: string;
  readonly kind: SweetSpotKind;
  readonly title: string;
  readonly description: string;
  /** Typical points for one `unit` (a representative figure, not a quote). */
  readonly pointsCost: number;
  /** Typical range across seasons/routes/categories. */
  readonly pointsCostMin: number;
  readonly pointsCostMax: number;
  readonly unit: SweetSpotUnit;
  /** Typical cash price of one unit in US cents, when used to derive cpp. */
  readonly cashValueCents: number | null;
  /** Estimated value of one point on this redemption, in US cents. */
  readonly estimatedCentsPerPoint: number;
  /** How the cpp was obtained: derived from cash/points or purely editorial. */
  readonly cppBasis: "derived" | "editorial";
  /** Upper bound on units a plan will suggest in one go. */
  readonly maxUnits: number;
  readonly constraints: readonly string[];
  readonly confidence: SweetSpotConfidence;
  readonly lastReviewed: string;
  /** Always false in this catalog: nothing here was checked against a live site. */
  readonly verified: false;
}

interface SpotSeed {
  readonly id: string;
  readonly programId: string;
  readonly kind: SweetSpotKind;
  readonly title: string;
  readonly description: string;
  readonly cost: number;
  readonly range: readonly [number, number];
  readonly unit: SweetSpotUnit;
  /** Either typical cash value (cents) to derive cpp, or editorial cpp. */
  readonly cash?: number;
  readonly cpp?: number;
  readonly maxUnits?: number;
  readonly constraints: readonly string[];
  readonly confidence: "medium" | "low";
}

function spot(seed: SpotSeed): SweetSpot {
  const derived = seed.cash !== undefined;
  const cpp = derived
    ? Math.round((seed.cash! / seed.cost) * 100) / 100
    : (seed.cpp ?? 1);
  return {
    id: seed.id,
    programId: seed.programId,
    kind: seed.kind,
    title: seed.title,
    description: seed.description,
    pointsCost: seed.cost,
    pointsCostMin: seed.range[0],
    pointsCostMax: seed.range[1],
    unit: seed.unit,
    cashValueCents: derived ? seed.cash! : null,
    estimatedCentsPerPoint: cpp,
    cppBasis: derived ? "derived" : "editorial",
    maxUnits:
      seed.maxUnits ??
      (seed.unit === "night" ? 5 : seed.unit === "redemption" ? 1 : 2),
    constraints: seed.constraints,
    confidence: seed.confidence,
    lastReviewed: SWEET_SPOT_REVIEW_DATE,
    verified: false,
  };
}

const COMMON_FLIGHT = "Award space is limited and not guaranteed; search before transferring.";
const FUEL = "Carrier-imposed surcharges/taxes may apply and vary by program.";

export const SWEET_SPOTS: readonly SweetSpot[] = [
  // ─── Hotels ──────────────────────────────────────────────────────────────
  spot({
    id: "hyatt-cat1-4-standard",
    programId: "hyatt",
    kind: "hotel",
    title: "Hyatt category 1-4 hotels, standard nights",
    description:
      "Everyday Hyatt properties priced low on the award chart; cash rates at these hotels are often several times the points price in cents.",
    cost: 8_000,
    range: [3_500, 15_000],
    unit: "night",
    cash: 17_000,
    constraints: [
      "Price depends on category and off-peak/standard/peak date.",
      "Hotel categories are revised periodically; check the current chart.",
    ],
    confidence: "medium",
  }),
  spot({
    id: "hyatt-cat5-7-resort",
    programId: "hyatt",
    kind: "hotel",
    title: "Hyatt category 5-7 resorts and city flagships",
    description:
      "Higher-category Hyatts where cash rates can be very high on peak dates, so the fixed award price looks strong.",
    cost: 25_000,
    range: [17_000, 35_000],
    unit: "night",
    cash: 50_000,
    constraints: ["Value swings a lot with cash price on the dates chosen."],
    confidence: "low",
  }),
  spot({
    id: "marriott-offpeak-low-category",
    programId: "marriott",
    kind: "hotel",
    title: "Marriott low-category hotels, off-peak",
    description:
      "Marriott uses variable pricing; low-category properties on off-peak dates are the cheapest tier.",
    cost: 15_000,
    range: [5_000, 25_000],
    unit: "night",
    cash: 14_000,
    constraints: [
      "Bonvoy award prices vary by date and hotel; typical values only.",
      "Points are usually worth less here than at Hyatt; compare before transferring.",
    ],
    confidence: "low",
  }),
  spot({
    id: "marriott-5th-night-free",
    programId: "marriott",
    kind: "hotel",
    title: "Marriott award stay of 5+ nights (5th night free)",
    description:
      "Marriott generally discounts the fifth night of a longer award stay, lifting the effective value of the points.",
    cost: 100_000,
    range: [60_000, 150_000],
    unit: "stay",
    cash: 125_000,
    maxUnits: 1,
    constraints: [
      "Five consecutive nights at one property.",
      "Verify the current policy and the per-night price on the booking page.",
    ],
    confidence: "low",
  }),
  spot({
    id: "hilton-5th-night-free",
    programId: "hilton",
    kind: "hotel",
    title: "Hilton award stay of 5+ nights (5th night free)",
    description:
      "Eligible Hilton members get the fifth night of a longer award stay free, which raises the value of Hilton's low-value points.",
    cost: 120_000,
    range: [80_000, 200_000],
    unit: "stay",
    cash: 100_000,
    maxUnits: 1,
    constraints: [
      "Eligibility depends on status or card; check the current terms.",
      "Hilton points are usually worth well under 1 cent each without this.",
    ],
    confidence: "low",
  }),
  spot({
    id: "ihg-4th-night-free",
    programId: "ihg-one-rewards",
    kind: "hotel",
    title: "IHG award stay with 4th night free",
    description:
      "IHG co-brand card holders typically get a free fourth night on a four-night award stay.",
    cost: 120_000,
    range: [60_000, 180_000],
    unit: "stay",
    cash: 100_000,
    maxUnits: 1,
    constraints: ["Requires an eligible IHG credit card or status.", "Four consecutive nights."],
    confidence: "low",
  }),
  spot({
    id: "ihg-pointbreaks",
    programId: "ihg-one-rewards",
    kind: "hotel",
    title: "IHG PointBreaks promotional nights",
    description:
      "IHG periodically publishes a list of hotels at a low flat points price per night.",
    cost: 8_000,
    range: [5_000, 12_000],
    unit: "night",
    cash: 12_000,
    constraints: ["The hotel list rotates; only valid for listed hotels and dates."],
    confidence: "low",
  }),
  spot({
    id: "wyndham-flat-rate",
    programId: "wyndham-rewards",
    kind: "hotel",
    title: "Wyndham flat-rate award nights",
    description:
      "Wyndham charges a small fixed number of points per night by tier regardless of cash price, which is good when cash rates are high.",
    cost: 15_000,
    range: [7_500, 30_000],
    unit: "night",
    cash: 19_500,
    constraints: ["Mid-range hotels dominate the program; luxury is limited."],
    confidence: "medium",
  }),
  spot({
    id: "choice-privileges-night",
    programId: "choice-privileges",
    kind: "hotel",
    title: "Choice Privileges award nights",
    description:
      "Choice awards use a reward-night price by hotel tier; best at hotels where cash rates run high.",
    cost: 16_000,
    range: [8_000, 35_000],
    unit: "night",
    cash: 12_800,
    constraints: ["Value depends heavily on the hotel's cash rate."],
    confidence: "low",
  }),
  spot({
    id: "accor-reward-credit",
    programId: "accor-all",
    kind: "hotel",
    title: "Accor ALL points as spend credit",
    description:
      "Accor converts points to euro spending credit at a fixed rate (about 2,000 points for EUR 40).",
    cost: 2_000,
    range: [2_000, 2_000],
    unit: "redemption",
    cpp: 2.2,
    maxUnits: 25,
    constraints: [
      "Applies to Accor spend (stays, dining); conversion to USD uses current FX.",
      "Rate shown is approximate; confirm in the Accor app.",
    ],
    confidence: "low",
  }),

  // ─── Flights: transferable-partner programs ──────────────────────────────
  spot({
    id: "flying-blue-promo-rewards",
    programId: "flying-blue",
    kind: "flight",
    title: "Flying Blue Promo Rewards (monthly discounted awards)",
    description:
      "Each month Flying Blue discounts selected routes by a large percentage; transatlantic economy and business are the typical targets.",
    cost: 30_000,
    range: [15_000, 60_000],
    unit: "one_way",
    cash: 70_000,
    constraints: [
      "Routes and discounts change every month; may sell out quickly.",
      FUEL,
      COMMON_FLIGHT,
    ],
    confidence: "medium",
  }),
  spot({
    id: "virgin-atlantic-ana-business",
    programId: "virgin-atlantic-flying-club",
    kind: "flight",
    title: "Virgin Atlantic Flying Club -> ANA business class to Japan",
    description:
      "Virgin Atlantic prices ANA premium cabins on its own chart, historically far below ANA's own pricing for one-way business class.",
    cost: 90_000,
    range: [60_000, 110_000],
    unit: "one_way",
    cash: 400_000,
    constraints: [
      "Space for Virgin Atlantic on ANA is scarce and released close to departure.",
      "Chart has changed before; confirm the current price.",
      COMMON_FLIGHT,
    ],
    confidence: "low",
  }),
  spot({
    id: "virgin-atlantic-delta-one",
    programId: "virgin-atlantic-flying-club",
    kind: "flight",
    title: "Virgin Atlantic Flying Club -> Delta One transatlantic",
    description:
      "Virgin Atlantic can book Delta One to Europe at a distance-/zone-based price that was often lower than Delta's own.",
    cost: 60_000,
    range: [50_000, 80_000],
    unit: "one_way",
    cash: 300_000,
    constraints: [COMMON_FLIGHT, "Partner pricing may change without notice."],
    confidence: "low",
  }),
  spot({
    id: "aeroplan-stopover",
    programId: "air-canada-aeroplan",
    kind: "flight",
    title: "Aeroplan stopover on an international award",
    description:
      "Aeroplan allows a stopover on many one-way international awards for a modest extra points charge, effectively a second destination.",
    cost: 5_000,
    range: [5_000, 10_000],
    unit: "redemption",
    cash: 30_000,
    maxUnits: 1,
    constraints: [
      "Stopover rules differ by route and cabin.",
      "This is an add-on to a main award, not a standalone purchase.",
    ],
    confidence: "low",
  }),
  spot({
    id: "aeroplan-star-alliance-business",
    programId: "air-canada-aeroplan",
    kind: "flight",
    title: "Aeroplan Star Alliance partner business class",
    description:
      "Aeroplan books many Star Alliance carriers on a partner chart and does not pass on fuel surcharges for most of them.",
    cost: 70_000,
    range: [60_000, 100_000],
    unit: "one_way",
    cash: 350_000,
    constraints: [
      "Partner space is released by each airline and can be sparse.",
      "Prices rise with distance and cabin; verify on the booking page.",
      COMMON_FLIGHT,
    ],
    confidence: "medium",
  }),
  spot({
    id: "avios-short-haul-economy",
    programId: "british-airways-avios",
    kind: "flight",
    title: "Avios distance-based short-haul economy",
    description:
      "British Airways Avios prices partner flights by distance, so short flights (including some US domestic partner flights) are cheap.",
    cost: 7_500,
    range: [4_500, 12_000],
    unit: "one_way",
    cash: 18_000,
    constraints: [
      "Only short distances work well; long routes get expensive.",
      "Fees on BA-operated flights can be high.",
    ],
    confidence: "medium",
  }),
  spot({
    id: "iberia-offpeak-business",
    programId: "iberia-plus",
    kind: "flight",
    title: "Iberia Plus off-peak business class to Madrid",
    description:
      "Iberia's own program offers off-peak business class awards to Spain at a comparatively low Avios price and lower surcharges than some peers.",
    cost: 34_000,
    range: [34_000, 100_000],
    unit: "one_way",
    cash: 180_000,
    constraints: ["Off-peak dates only for the low price.", COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "american-web-special",
    programId: "american",
    kind: "flight",
    title: "AAdvantage Web Special awards",
    description:
      "American periodically sells award seats below the standard price through Web Specials, mostly on its own domestic and some partner flights.",
    cost: 12_500,
    range: [6_000, 30_000],
    unit: "one_way",
    cash: 22_000,
    constraints: ["Limited seats; check the Web Specials page.", COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "american-offpeak-partner-business",
    programId: "american",
    kind: "flight",
    title: "AAdvantage off-peak partner business class (Asia)",
    description:
      "American's off-peak pricing on oneworld partners such as Japan Airlines has been a long-running value for business class to Asia.",
    cost: 60_000,
    range: [57_500, 75_000],
    unit: "one_way",
    cash: 350_000,
    constraints: ["Off-peak dates only.", FUEL, COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "united-saver-domestic",
    programId: "united",
    kind: "flight",
    title: "United Saver domestic one-way",
    description:
      "United Saver awards on shorter domestic routes when space is released.",
    cost: 10_000,
    range: [6_500, 15_000],
    unit: "one_way",
    cash: 22_000,
    constraints: ["Prices vary by date and route.", COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "united-excursionist-perk",
    programId: "united",
    kind: "flight",
    title: "United Excursionist Perk (free one-way within a region)",
    description:
      "On a qualifying multi-city international award, one extra one-way flight inside the destination region can be added at no extra miles.",
    cost: 80_000,
    range: [60_000, 120_000],
    unit: "round_trip",
    cash: 120_000,
    maxUnits: 1,
    constraints: [
      "Requires a multi-city booking with the free segment as the second leg.",
      "Rules are intricate; read the current terms before booking.",
    ],
    confidence: "low",
  }),
  spot({
    id: "atmos-partner-premium",
    programId: "alaska-atmos-rewards",
    kind: "flight",
    title: "Atmos Rewards partner premium-cabin awards",
    description:
      "Alaska's loyalty program (Atmos Rewards) has historically offered competitive prices on oneworld partners such as Japan Airlines and Cathay Pacific.",
    cost: 70_000,
    range: [50_000, 100_000],
    unit: "one_way",
    cash: 350_000,
    constraints: [
      "The chart changed with the Atmos Rewards relaunch; confirm the current price.",
      COMMON_FLIGHT,
    ],
    confidence: "low",
  }),
  spot({
    id: "krisflyer-saver-premium",
    programId: "singapore-krisflyer",
    kind: "flight",
    title: "KrisFlyer Singapore Airlines Saver premium cabins",
    description:
      "Saver-level awards on Singapore Airlines business and suites are a common aspirational use of transferable points.",
    cost: 90_000,
    range: [60_000, 140_000],
    unit: "one_way",
    cash: 450_000,
    constraints: [
      "Saver space is limited; many dates only show higher-priced Advantage space.",
      COMMON_FLIGHT,
    ],
    confidence: "low",
  }),
  spot({
    id: "cathay-asia-miles-business",
    programId: "cathay-asia-miles",
    kind: "flight",
    title: "Asia Miles Cathay Pacific business class",
    description:
      "Cathay's own business-class awards to Hong Kong and on partners can be reasonable value.",
    cost: 75_000,
    range: [60_000, 100_000],
    unit: "one_way",
    cash: 400_000,
    constraints: [COMMON_FLIGHT, FUEL],
    confidence: "low",
  }),
  spot({
    id: "lifemiles-star-alliance",
    programId: "avianca-lifemiles",
    kind: "flight",
    title: "LifeMiles Star Alliance partner awards (no surcharges)",
    description:
      "LifeMiles prices many Star Alliance premium cabins without fuel surcharges; prices have been revised several times.",
    cost: 70_000,
    range: [55_000, 100_000],
    unit: "one_way",
    cash: 350_000,
    constraints: ["Chart changes frequently; confirm before transferring.", COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "turkish-star-alliance-business",
    programId: "turkish-miles-and-smiles",
    kind: "flight",
    title: "Miles&Smiles Star Alliance business class",
    description:
      "Turkish's partner chart has historically been low for Star Alliance business class from the US to Europe.",
    cost: 45_000,
    range: [45_000, 90_000],
    unit: "one_way",
    cash: 280_000,
    constraints: ["Partner award prices and booking rules have changed; verify.", COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "qantas-aa-short-haul",
    programId: "qantas-frequent-flyer",
    kind: "flight",
    title: "Qantas Points on short American Airlines flights",
    description:
      "Qantas prices oneworld partner flights by distance, which makes short American Airlines flights cheap.",
    cost: 8_000,
    range: [6_500, 15_000],
    unit: "one_way",
    cash: 18_000,
    constraints: ["Distance bands apply; long flights are poor value.", "Taxes and fees vary."],
    confidence: "low",
  }),
  spot({
    id: "ana-roundtrip-business",
    programId: "ana-mileage-club",
    kind: "flight",
    title: "ANA Mileage Club round-trip business class to Japan",
    description:
      "ANA's own round-trip award chart for business class to Japan is bi-seasonal and often beats the one-way partner price.",
    cost: 115_000,
    range: [88_000, 150_000],
    unit: "round_trip",
    cash: 700_000,
    maxUnits: 1,
    constraints: ["Round trip only; ANA space is limited.", COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "jal-domestic-japan",
    programId: "jal-mileage-bank",
    kind: "flight",
    title: "JAL domestic flights within Japan",
    description:
      "Domestic Japan flights are priced low in JAL's partner awards and can be a useful add-on to a trip.",
    cost: 8_000,
    range: [5_000, 12_000],
    unit: "one_way",
    cash: 15_000,
    constraints: ["Booked as an award on a partner program; requires an international ticket."],
    confidence: "low",
  }),
  spot({
    id: "qatar-qsuites",
    programId: "qatar-privilege-club",
    kind: "flight",
    title: "Qatar Privilege Club Qsuites business class",
    description:
      "Qatar's own program can book Qsuites; pricing is distance-based on its own chart.",
    cost: 75_000,
    range: [60_000, 100_000],
    unit: "one_way",
    cash: 400_000,
    constraints: [COMMON_FLIGHT],
    confidence: "low",
  }),
  spot({
    id: "southwest-fixed-value",
    programId: "southwest-rapid-rewards",
    kind: "flight",
    title: "Southwest Rapid Rewards fares (points track cash price)",
    description:
      "Rapid Rewards points are worth roughly a fixed amount of the cash fare, so value is stable but rarely extraordinary.",
    cost: 10_000,
    range: [3_000, 40_000],
    unit: "one_way",
    cash: 14_000,
    constraints: ["Points price follows the cash fare; Companion Pass changes the math (see terms)."],
    confidence: "medium",
  }),
  spot({
    id: "jetblue-fixed-value",
    programId: "jetblue-trueblue",
    kind: "flight",
    title: "JetBlue TrueBlue fares (points track cash price)",
    description:
      "TrueBlue points are redeemed at a roughly fixed rate against the cash fare.",
    cost: 10_000,
    range: [3_000, 40_000],
    unit: "one_way",
    cash: 13_000,
    constraints: ["Value drops on cheap fares; best on high-priced cash fares."],
    confidence: "medium",
  }),
  spot({
    id: "delta-skymiles-saver",
    programId: "delta",
    kind: "flight",
    title: "Delta SkyMiles cheap domestic award fares",
    description:
      "Delta awards are dynamically priced; occasionally low-fare dates are a decent value.",
    cost: 12_000,
    range: [5_000, 50_000],
    unit: "one_way",
    cash: 15_000,
    constraints: ["Dynamic pricing; best case, not typical."],
    confidence: "low",
  }),

  // ─── Rail / portals / other ──────────────────────────────────────────────
  spot({
    id: "amtrak-northeast",
    programId: "amtrak",
    kind: "other",
    title: "Amtrak Guest Rewards on Northeast corridor trains",
    description:
      "Points prices are tied to the fare; flexible dates on high-priced Northeast corridor trains can give good value.",
    cost: 8_000,
    range: [3_000, 20_000],
    unit: "one_way",
    cash: 20_000,
    constraints: ["Value depends on cash fare for the exact train."],
    confidence: "low",
  }),
  spot({
    id: "chase-travel-portal",
    programId: "chase-ultimate-rewards",
    kind: "other",
    title: "Chase Travel portal at a fixed boosted rate",
    description:
      "Some Chase cards value points at more than 1 cent when redeeming through the Chase Travel portal. A floor to compare transfer options against.",
    cost: 10_000,
    range: [1_000, 500_000],
    unit: "redemption",
    cpp: 1.25,
    maxUnits: 10,
    constraints: ["The rate depends on the card; portal prices can be higher than elsewhere."],
    confidence: "medium",
  }),
  spot({
    id: "amex-travel-portal",
    programId: "amex-membership-rewards",
    kind: "other",
    title: "Amex Travel portal / pay with points",
    description: "Typically about 1 cent per point on flights through Amex Travel: a baseline to beat.",
    cost: 10_000,
    range: [1_000, 500_000],
    unit: "redemption",
    cpp: 1,
    maxUnits: 10,
    constraints: ["Rates vary by card and booking type."],
    confidence: "medium",
  }),
  spot({
    id: "capital-one-travel-eraser",
    programId: "capital-one-miles",
    kind: "other",
    title: "Capital One Travel and purchase eraser",
    description: "Miles redeem at a fixed 1 cent each for travel or to erase travel purchases: a baseline to beat.",
    cost: 10_000,
    range: [5_000, 500_000],
    unit: "redemption",
    cpp: 1,
    maxUnits: 10,
    constraints: ["Fixed value, not a sweet spot; useful only as a floor."],
    confidence: "medium",
  }),
  spot({
    id: "citi-travel-portal",
    programId: "citi-thankyou",
    kind: "other",
    title: "Citi Travel portal",
    description: "ThankYou points are typically worth around 1 cent each in the Citi Travel portal: a baseline.",
    cost: 10_000,
    range: [1_000, 500_000],
    unit: "redemption",
    cpp: 1,
    maxUnits: 10,
    constraints: ["Value varies by card."],
    confidence: "low",
  }),
];

const BY_ID = new Map(SWEET_SPOTS.map((s) => [s.id, s] as const));

export function findSweetSpot(id: string): SweetSpot | undefined {
  return BY_ID.get(id);
}

export function listSweetSpots(filter?: {
  readonly kind?: SweetSpotKind;
  readonly programId?: string;
}): SweetSpot[] {
  return SWEET_SPOTS.filter(
    (s) =>
      (!filter?.kind || s.kind === filter.kind) &&
      (!filter?.programId || s.programId === filter.programId),
  );
}
