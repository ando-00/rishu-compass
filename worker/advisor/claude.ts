import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODEL_ID, toModelError } from "../rule-extraction/claude";
import type { AdvisorLoop } from "./advise";

const MAX_TOKENS = 16000;
// 設計書 v4 第5節。超えたら案を出さず、職員確認にする。
const MAX_ITERATIONS = 6;

export function createAdvisorLoop(apiKey: string): AdvisorLoop {
  const client = new Anthropic({ apiKey });

  return async ({ system, prompt, tools }) => {
    try {
      const runner = client.beta.messages.toolRunner({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        max_iterations: MAX_ITERATIONS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: tools.map(({ name, description, inputSchema, run }) =>
          betaZodTool({ name, description, inputSchema, run, strict: true }),
        ),
        messages: [{ role: "user", content: prompt }],
      });

      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let iterations = 0;
      let stopReason: string | null = null;
      for await (const message of runner) {
        iterations += 1;
        stopReason = message.stop_reason;
        usage.inputTokens += message.usage.input_tokens;
        usage.outputTokens += message.usage.output_tokens;
        usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
      }
      return { stopReason, iterations, usage };
    } catch (cause) {
      throw toModelError(cause);
    }
  };
}
