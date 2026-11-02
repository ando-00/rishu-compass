-- 履修案の作成の記録。行を追記するだけで、更新も削除もしない。
-- advice は画面へ返した結果を JSON で持つ。検査を通った案、声かけ文の下書き、職員に回した理由が入る。
-- answers は案を作ったときの回答で、同じ回答の案を見せ直すときの照合に使う。
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  answers TEXT NOT NULL,
  advice TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX plans_latest ON plans (dataset_id, student_id, answers, id);
