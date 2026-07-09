import type { AssistantMessage, LlmAssistant } from "../../application/ports";

/**
 * Minimal structural view of the parts of `@aws-sdk/client-bedrock-runtime`
 * this adapter uses. Declaring it here keeps the domain package free of a hard
 * type dependency on the AWS SDK at the port boundary and makes the adapter
 * unit-testable with a fake client (no AWS calls, no credentials).
 */
export interface BedrockConverseMessage {
  readonly role: "user" | "assistant";
  readonly content: Array<{ readonly text: string }>;
}

export interface BedrockConverseInput {
  readonly modelId: string;
  readonly system?: Array<{ readonly text: string }>;
  readonly messages: BedrockConverseMessage[];
  readonly inferenceConfig?: {
    readonly maxTokens?: number;
    readonly temperature?: number;
  };
}

export interface BedrockConverseOutput {
  readonly output?: {
    readonly message?: {
      readonly content?: Array<{ readonly text?: string }>;
    };
  };
  readonly stopReason?: string;
}

/** The single method this adapter needs from BedrockRuntimeClient. */
export interface BedrockConverseClient {
  converse(input: BedrockConverseInput): Promise<BedrockConverseOutput>;
}

export interface BedrockAssistantConfig {
  /**
   * Bedrock model or inference-profile id — provider-prefixed on Bedrock, e.g.
   * `anthropic.claude-sonnet-5` (Claude Sonnet 5). Region-scoped inference
   * profiles (`us.anthropic.…`, `global.anthropic.…`) also work; verify model
   * access is enabled in the target account/region. Provide via env
   * (`BEDROCK_MODEL_ID`).
   */
  readonly modelId: string;
  readonly region?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /**
   * Inject a client for testing. In production, omit and this adapter lazily
   * constructs a `BedrockRuntimeClient` from `@aws-sdk/client-bedrock-runtime`,
   * relying on the ambient AWS credential chain (the ECS task role in AWS).
   */
  readonly client?: BedrockConverseClient;
}

/**
 * AWS Bedrock adapter for the assistant port, using the provider-neutral
 * Converse API (`@aws-sdk/client-bedrock-runtime`). Credentials come from the
 * ambient AWS chain — the ECS task role grants `bedrock:InvokeModel`; no API
 * keys live in the container. Falls back to the heuristic assistant locally
 * where no AWS credentials are configured (selected in the composition root).
 */
export class BedrockAssistant implements LlmAssistant {
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private client: BedrockConverseClient | undefined;

  constructor(private readonly config: BedrockAssistantConfig) {
    this.modelId = config.modelId;
    this.maxTokens = config.maxTokens ?? 1024;
    this.temperature = config.temperature ?? 0.4;
    this.client = config.client;
  }

  async complete(input: {
    readonly system: string;
    readonly messages: readonly AssistantMessage[];
  }): Promise<string> {
    const client = await this.getClient();

    const response = await client.converse({
      modelId: this.modelId,
      system: input.system ? [{ text: input.system }] : undefined,
      messages: toConverseMessages(input.messages),
      inferenceConfig: {
        maxTokens: this.maxTokens,
        temperature: this.temperature,
      },
    });

    const text = (response.output?.message?.content ?? [])
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new Error(
        `Bedrock returned an empty completion (stopReason: ${response.stopReason ?? "unknown"})`,
      );
    }
    return text;
  }

  private async getClient(): Promise<BedrockConverseClient> {
    if (this.client) return this.client;

    // Lazy import so the AWS SDK is only loaded when Bedrock is actually
    // selected, and never pulled into surfaces that don't use it.
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const runtime = new BedrockRuntimeClient(
      this.config.region ? { region: this.config.region } : {},
    );
    this.client = {
      converse: (converseInput) =>
        runtime.send(
          new ConverseCommand(converseInput as never),
        ) as Promise<BedrockConverseOutput>,
    };
    return this.client;
  }
}

/**
 * Adapt the port's message list to the Converse wire shape. The Converse API
 * only accepts `user`/`assistant` roles and rejects consecutive same-role
 * turns, so we map any `system`-role message to `user` and merge adjacent
 * same-role messages into a single turn.
 */
function toConverseMessages(
  messages: readonly AssistantMessage[],
): BedrockConverseMessage[] {
  const merged: BedrockConverseMessage[] = [];
  for (const message of messages) {
    if (!message.content) continue;
    const role: "user" | "assistant" =
      message.role === "assistant" ? "assistant" : "user";
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.content.push({ text: message.content });
    } else {
      merged.push({ role, content: [{ text: message.content }] });
    }
  }
  return merged;
}
