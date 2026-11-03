import type { JudgmentStatus } from "../shared/api";
import type { MeetingSheet } from "./meetingSheet";
import { JudgmentBadge } from "./StatusBadge";

const STATUSES: JudgmentStatus[] = ["delay_risk", "short", "needs_staff", "expected", "satisfied"];

type Props = {
  sheet: MeetingSheet;
  datasetName: string;
  onClose: () => void;
};

// 確認事項を会議で諮るための1枚。画面の中で見るか、印刷する。学生 ID は載せない
export function MeetingSheetView({ sheet, datasetName, onClose }: Props) {
  const { summary, items } = sheet;
  return (
    <article className="card meeting-sheet">
      <div className="sheet-actions">
        <button type="button" onClick={() => window.print()}>
          印刷する
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          確認事項に戻る
        </button>
      </div>
      <h2>確認事項の会議資料</h2>
      <p className="muted">
        {datasetName}　作成 {new Date().toLocaleString("ja-JP")}　履修コンパス（試作品。データはすべて架空）
      </p>
      <p>
        要項の読み方が分かれる箇所が {items.length}件あります。今の判定では、学生 {summary.total}人のうち、声かけ{" "}
        {summary.contact}人、職員確認 {summary.staffReview}人、対応なし {summary.clear}人です。
        人数は判定の値をコードで数えたもので、学生 ID は載せていません。
      </p>
      {items.length === 0 && <p className="muted">未回答の確認事項はありません。</p>}
      {items.map((item, index) => (
        <section className="sheet-item" key={item.ambiguityId}>
          <h3>
            {index + 1}. {item.clause}　{item.question}
          </h3>
          <blockquote>{item.sourceQuote}</blockquote>
          {item.computable ? (
            <p>
              回答で判定が変わる学生 <strong>{item.affected}人</strong>
              <span className="muted">（別途、職員確認の学生 {item.staffReview}人）</span>
            </p>
          ) : (
            <p className="notice">この確認事項の読み方はルールの差分で表せないため、人数は計算できません。</p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>読み方</th>
                  {item.computable &&
                    STATUSES.map((status) => (
                      <th key={status}>
                        <JudgmentBadge status={status} />
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {item.options.map((option) => (
                  <tr key={option.label}>
                    <td>
                      {option.label}
                      {!option.reflected && <span className="muted">（判定には反映しない）</span>}
                    </td>
                    {item.computable &&
                      STATUSES.map((status) => (
                        <td key={status} className="nowrap">
                          {option.counts?.[status] ?? 0}人
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sheet-decision">決定: ＿＿＿＿＿＿＿＿＿＿＿＿　決定日: ＿＿＿＿＿＿</p>
        </section>
      ))}
    </article>
  );
}
