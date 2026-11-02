import type { RuleSet } from "../../engine";
import { checkProposal } from "./check";
import { ModelError, type FailureKind, type ModelReply, type ModelUsage, type StructuredModel } from "./model";
import { buildContent, type RepairRequest } from "./prompt";
import {
  extractionOutputSchema,
  toRuleSet,
  type ExtractionNote,
  type ExtractionSource,
} from "./schema";

export const MAX_REPAIRS = 3;

export type ExtractionInput = ExtractionSource & { handbook: string };

export type Attempt = {
  problems: number;
  model: string;
  usage: ModelUsage;
};

export type ExtractionFailure = { kind: FailureKind; message: string };

// 評価が初回と修正後の案を比べるために、回ごとの案を受け取る。
export type AttemptObserver = (proposal: {
  rules: RuleSet;
  notes: ExtractionNote[];
  problems: string[];
}) => void;

export type ExtractionResult =
  | { ok: true; rules: RuleSet; notes: ExtractionNote[]; problems: string[]; attempts: Attempt[] }
  | { ok: false; failure: ExtractionFailure; attempts: Attempt[] };

function parseReply({ stopReason, text }: ModelReply) {
  if (stopReason === "refusal") {
    throw new ModelError("refusal", "Claude が要項の変換を断りました。");
  }
  if (stopReason !== "end_turn") {
    throw new ModelError("truncated", `応答が途中で終わりました（${stopReason}）。`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ModelError("invalid_format", "応答を JSON として読めません。");
  }
  const parsed = extractionOutputSchema.safeParse(json);
  if (!parsed.success) throw new ModelError("invalid_format", "応答の形式が正しくありません。");
  return parsed.data;
}

// 検査に落ちたら問題を渡して直させる。直らなければ、残った問題を職員に見せる。
export async function extractRules(
  model: StructuredModel,
  input: ExtractionInput,
  observe?: AttemptObserver,
): Promise<ExtractionResult> {
  const attempts: Attempt[] = [];
  let repair: RepairRequest | undefined;

  try {
    for (let round = 0; ; round += 1) {
      const reply = await model(buildContent(input, repair));
      const { rules, notes, problems: converted } = toRuleSet(parseReply(reply), input);
      const problems = rules ? checkProposal({ rules, notes, input, problems: converted }) : converted;
      attempts.push({ problems: problems.length, model: reply.model, usage: reply.usage });
      if (rules) observe?.({ rules, notes, problems });
      if (rules && (problems.length === 0 || round === MAX_REPAIRS)) {
        return { ok: true, rules, notes, problems, attempts };
      }
      if (round === MAX_REPAIRS) {
        throw new ModelError("invalid_format", "卒業要件を読み取れませんでした。");
      }
      repair = { output: reply.text, problems };
    }
  } catch (cause) {
    if (!(cause instanceof ModelError)) throw cause;
    return { ok: false, failure: { kind: cause.kind, message: cause.message }, attempts };
  }
}
