import { z } from "zod";

const schema = z.object({
  ASSISTANT_RUNTIME: z.enum(["agents", "legacy"]).default("legacy"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ASSISTANT_MODEL: z.string().min(1).max(128).optional(),
  ASSISTANT_TRACING_ENABLED: z.enum(["true", "false"]).default("false"),
  ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  ASSISTANT_MAX_TURNS: z.coerce.number().int().min(1).max(12).default(5),
});

export function assistantConfig(input: Record<string, unknown>) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid assistant configuration.");
  const data = parsed.data;
  if (data.ASSISTANT_RUNTIME === "agents" && (!data.OPENAI_API_KEY || !data.ASSISTANT_MODEL)) {
    throw new Error("Agents runtime requires OPENAI_API_KEY and ASSISTANT_MODEL.");
  }
  return { runtime: data.ASSISTANT_RUNTIME, apiKey: data.OPENAI_API_KEY, model: data.ASSISTANT_MODEL, tracing: data.ASSISTANT_TRACING_ENABLED === "true", timeoutMs: data.ASSISTANT_TIMEOUT_MS, maxTurns: data.ASSISTANT_MAX_TURNS };
}
export type AssistantConfig = ReturnType<typeof assistantConfig>;
