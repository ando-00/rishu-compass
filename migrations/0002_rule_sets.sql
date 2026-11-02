-- 要項の変換で作ったルール案。案そのものは書き換えない。
CREATE TABLE rule_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  handbook TEXT NOT NULL,
  proposal TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX rule_sets_latest ON rule_sets (source_id, id);

-- 職員の確定の記録。行を追記するだけで、更新も削除もしない。
-- ルール案ごとの最新の行が今の状態で、action が withdraw の行は確定の取り消しを表す。
-- accepted_rule_ids は、職員が認めた要確認のルールの id を JSON の配列で持つ。
-- respondent には「教務職員A」のような役割名だけを入れ、実名を入れない。
CREATE TABLE rule_set_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_set_id INTEGER NOT NULL REFERENCES rule_sets (id),
  action TEXT NOT NULL CHECK (action IN ('confirm', 'withdraw')),
  accepted_rule_ids TEXT NOT NULL,
  respondent TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);

CREATE INDEX rule_set_confirmations_latest ON rule_set_confirmations (rule_set_id, id);
