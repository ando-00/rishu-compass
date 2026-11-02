-- 曖昧箇所への回答の記録。行を追記するだけで、更新も削除もしない。
-- 曖昧箇所ごとの最新の行が今の回答で、option_id が NULL の行は回答の取り消しを表す。
-- respondent には「教務職員A」のような役割名だけを入れ、実名を入れない。
CREATE TABLE ambiguity_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  ambiguity_id TEXT NOT NULL,
  option_id TEXT,
  respondent TEXT NOT NULL,
  answered_at TEXT NOT NULL
);

CREATE INDEX ambiguity_answers_latest ON ambiguity_answers (dataset_id, ambiguity_id, id);
