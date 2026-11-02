import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ModelError, type ContentBlock, type StructuredModel } from "./model";
import { SYSTEM_PROMPT } from "./prompt";
import { extractionOutputSchema } from "./schema";

export const MODEL_ID = "claude-opus-5-5";
const MAX_TOKENS = 64000;
// SDK に解析させると、打ち切りや途中の引き継ぎが種類のない例外になる。検査は extract.ts の parseReply が行う。
const { type, schema } = betaZodOutputFormat(extractionOutputSchema);
const OUTPUT_FORMAT = { type, schema };

function toParam({ text, cache }: ContentBlock) {
  return {
    type: "text" as const,
    text,
    ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  };
}

export function toModelError(cause: unknown) {
  if (cause instanceof Anthropic.RateLimitError) {
    return new ModelError("rate_limited", "API の利用の上限に達しました。時間をおいてください。");
  }
  if (cause instanceof Anthropic.APIConnectionTimeoutError) {
    return new ModelError("timeout", "API の応答が時間内に届きませんでした。");
  }
  if (cause instanceof Anthropic.APIError) {
    return new ModelError("api_error", `API の呼び出しに失敗しました: ${cause.message}`);
  }
  return cause;
}

export function createClaudeModel(apiKey: string): StructuredModel {
  const client = new Anthropic({ apiKey });

  return async (content) => {
    try {
      const message = await client.beta.messages
        .stream({
          model: MODEL_ID,
          max_tokens: MAX_TOKENS,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "high", format: OUTPUT_FORMAT },
          system: [{ type: "text", text: SYSTEM_PROMPT }],
          messages: [{ role: "user", content: content.map(toParam) }],
        })
        .finalMessage();

      const { usage } = message;
      // 別のモデルへ引き継いだときは、引き継いだ後の本文が応答になる。
      const start = message.content.findLastIndex((block) => block.type === "fallback") + 1;
      return {
        stopReason: message.stop_reason,
        text: message.content
          .slice(start)
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(""),
        model: message.model,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (cause) {
      throw toModelError(cause);
    }
  };
}
