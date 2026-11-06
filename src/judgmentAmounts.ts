import { amountNote } from "../engine/outreach";
import type { Judgment } from "../shared/api";

// 学生別の画面は、職員確認の判定にも仮の値の量を出す（職員が成績と突き合わせる材料になる）。
// 未回答の確認事項で止まった判定には、量が変わりうることを添える（H36。文は engine/outreach.ts の H19 とそろえる）
export function amountCaveat({ status, ambiguityIds, required, actual, missingCourses, unreflected }: Judgment) {
  const hasAmount = (required !== undefined && actual !== undefined) || (missingCourses?.length ?? 0) > 0;
  if (status !== "needs_staff" || ambiguityIds.length === 0 || !hasAmount) return null;
  return amountNote(unreflected);
}
