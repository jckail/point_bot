import type { AssistantMessage, LlmAssistant } from "../../application/ports";

export interface OpenAiCompatibleConfig {
  readonly apiKey: string;
  readonly model?: string;
  /** Defaults to OpenAI; set for Azure/Groq/Ollama-compatible endpoints. */
  readonly baseUrl?: string;
}

/**
 * OpenAI Chat Completions–compatible adapter (OpenAI, Groq, Azure OpenAI,
 * local Ollama with an OpenAI shim, etc.).
 */
export class OpenAiCompatibleAssistant implements LlmAssistant {
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.model = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
  }

  async complete(input: {
    readonly system: string;
    readonly messages: readonly AssistantMessage[];
  }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        messages: [
          { role: "system", content: input.system },
          ...input.messages.map((message) => ({
            role: message.role === "system" ? "user" : message.role,
            content: message.content,
          })),
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `LLM request failed (${response.status}): ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM returned an empty completion");
    }
    return content;
  }
}

/**
 * Deterministic local assistant used when no API key is configured.
 * Reads transfer/value hints embedded in the system prompt so demos still
 * feel useful offline.
 */
export class HeuristicAssistant implements LlmAssistant {
  async complete(input: {
    readonly system: string;
    readonly messages: readonly AssistantMessage[];
  }): Promise<string> {
    const lastUser =
      [...input.messages].reverse().find((m) => m.role === "user")?.content ??
      "";
    const lower = lastUser.toLowerCase();

    const hints = extractHintLines(input.system);
    const goalLines = extractSection(input.system, "Active trip goals:");
    const balanceLines = extractSection(input.system, "Balances:");

    if (/expir|lapse|forfeit/.test(lower)) {
      return [
        "Focus on programs with inactivity expiry first — sync or redeem something small to reset the clock.",
        balanceLines[0]
          ? `Start with: ${balanceLines[0].replace(/^- /, "")}.`
          : "Open Expiring soon on your dashboard for the tightest deadlines.",
        "I can also rank transfer options if you tell me which trip you're targeting.",
      ].join(" ");
    }

    if (/transfer|hyatt|united|hilton|chase|amex|bilt/.test(lower)) {
      if (hints.length > 0) {
        return [
          "Based on your balances, the strongest transfer moves right now look like:",
          ...hints.slice(0, 3).map((h) => `• ${h}`),
          "Confirm live transfer ratios and any bonus windows before you move points — transfers are usually irreversible.",
        ].join("\n");
      }
      return "Link a transferable credit-card currency (Chase UR, Amex MR, Bilt, etc.) and I'll rank partner transfers by effective cents-per-point.";
    }

    if (/goal|trip|kyoto|book|redeem|deal|bang|value|worth/.test(lower)) {
      const parts = [
        goalLines.length > 0
          ? `You're ${goalLines[0]?.replace(/^- /, "") ?? "tracking a goal"}.`
          : "Set a trip goal on the dashboard so I can aim advice at a target balance.",
        hints[0]
          ? `Best value hint: ${hints[0]}.`
          : "Check the Value & deals panel for curated sweet spots matched to what you hold.",
        "Ask me something like “Should I transfer UR to Hyatt?” for a concrete recommendation.",
      ];
      return parts.join(" ");
    }

    return [
      "I can help with transfer strategy, expiration risk, trip-goal progress, and bang-for-buck redemptions.",
      hints[0] ? `Quick win: ${hints[0]}.` : null,
      "Try: “What's my best transfer right now?” or paste a deal URL into Value & deals to scrape it.",
    ]
      .filter(Boolean)
      .join(" ");
  }
}

function extractSection(system: string, header: string): string[] {
  const idx = system.indexOf(header);
  if (idx < 0) return [];
  const rest = system.slice(idx + header.length);
  const lines = rest.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) out.push(line);
    else if (out.length > 0 && !line.startsWith("- ") && line.trim()) break;
  }
  return out;
}

function extractHintLines(system: string): string[] {
  return extractSection(system, "Transfer / value hints:").map((line) =>
    line.replace(/^- /, ""),
  );
}
