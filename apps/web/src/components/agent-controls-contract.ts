import { z } from "zod";
const date = z.string().datetime({ offset: true });
export const tokenSchema = z.object({ id: z.string(), label: z.string(), scopes: z.array(z.string()), createdAt: date, expiresAt: date, revokedAt: date.nullable(), lastUsedAt: date.nullable() });
export const consentSchema = z.object({ id: z.string(), accountId: z.string(), providerId: z.string(), grantedAt: date, expiresAt: date, revokedAt: date.nullable() });
export const observationSchema = z.object({ id: z.string(), accountId: z.string(), providerId: z.string(), points: z.number().int().nonnegative(), capturedAt: date, sourceHost: z.string(), sourceMethod: z.enum(["page_capture", "manual_entry"]).optional(), status: z.enum(["accepted", "held", "rejected"]), holdReason: z.string().nullable(), createdAt: date, reviewedAt: date.nullable() });
export const SCOPES = [
  { value: "portfolio:read", label: "Read portfolio", description: "Read program balances and portfolio details." },
  { value: "portfolio:write", label: "Update portfolio", description: "Change memberships, balances, and trip goals." },
  { value: "observations:write", label: "Submit captured balances", description: "Submit observations for accounts with capture consent." },
  { value: "sync:execute", label: "Sync balances", description: "Request a sync through a configured provider." },
  { value: "shares:write", label: "Manage share links", description: "Create or revoke portfolio sharing links." },
  { value: "assistant:chat", label: "Ask the assistant", description: "Send questions about your portfolio." },
  { value: "actions:propose", label: "Propose account changes", description: "Prepare changes that you review and approve in PointUp." },
] as const;
export type TokenDto = z.infer<typeof tokenSchema>;
export type ConsentDto = z.infer<typeof consentSchema>;
export type ObservationDto = z.infer<typeof observationSchema>;
export type CaptureAccount = { id: string; providerId: string; name: string; membershipHint: string; currentPoints: number | null };
