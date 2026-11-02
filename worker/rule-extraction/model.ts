export type ContentBlock = {
  text: string;
  // 同じ要項の修正と再変換で読み直しの費用を抑える
  cache?: boolean;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type ModelReply = {
  stopReason: string | null;
  text: string;
  model: string;
  usage: ModelUsage;
};

export type StructuredModel = (content: ContentBlock[]) => Promise<ModelReply>;

export type FailureKind =
  | "rate_limited"
  | "timeout"
  | "api_error"
  | "refusal"
  | "truncated"
  | "invalid_format";

export class ModelError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}
