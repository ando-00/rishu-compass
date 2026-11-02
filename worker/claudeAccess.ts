import type { FailureKind } from "./rule-extraction/model";

// 型の定義は .dev.vars から生成されるので、これがない環境でも通るようここに書く。
export type ClaudeBindings = {
  ANTHROPIC_API_KEY?: string;
  ALLOW_CLAUDE?: string;
};

// 公開 URL の利用の制限が決まるまで、明示して開けた環境でだけ Claude を呼ぶ。
export function claudeKey({ ALLOW_CLAUDE, ANTHROPIC_API_KEY }: ClaudeBindings) {
  return ALLOW_CLAUDE === "true" && ANTHROPIC_API_KEY ? ANTHROPIC_API_KEY : null;
}

export const FAILURE_STATUS: Record<FailureKind, 429 | 502 | 504> = {
  rate_limited: 429,
  timeout: 504,
  api_error: 502,
  refusal: 502,
  truncated: 502,
  invalid_format: 502,
};
