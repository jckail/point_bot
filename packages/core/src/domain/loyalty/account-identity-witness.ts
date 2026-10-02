import { z } from "zod";

/** Server-only identity evidence; never part of a proposal request or review DTO. */
export const manualBalanceAccountWitnessSchema = z.object({
  version: z.literal(1),
  kind: z.literal("manual_balance_account_identity"),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type ManualBalanceAccountWitness = z.infer<typeof manualBalanceAccountWitnessSchema>;
