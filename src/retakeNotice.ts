import type { RuleSet } from "../engine/rules";

// 変換の形式には失格の再履修を表すルールがない（H32）。確定すると、正解ルールで答えた再履修の読み方は判定に使われず、
// 失格の科目を止めずに判定する。職員が気づかないまま声かけの人数が変わらないよう、確定の前と後の画面で示す（独立の全体監査 V-2）
export function retakeNotice({ retake }: Pick<RuleSet, "retake">) {
  if (retake) return null;
  return "この案には、失格した科目の再履修を定めるルールがありません（変換の形式にこの項目がないため）。確定すると、失格した科目も止めずに判定します。正解ルールで再履修の確認事項に答えていても、その回答は使いません。声かけの人数が変わることがあります。要項を読んで確かめてください。";
}

export function confirmedRetakeNote(noRetakeRule: true | undefined) {
  return noRetakeRule ? "この版には失格の再履修のルールがないので、失格した科目も止めずに判定します。" : "";
}
