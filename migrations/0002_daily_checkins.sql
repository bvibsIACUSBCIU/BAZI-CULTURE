CREATE TABLE daily_checkins (
  user_id TEXT NOT NULL REFERENCES users(id),
  checkin_date TEXT NOT NULL,
  reward_points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, checkin_date)
);

CREATE INDEX daily_checkins_by_user_created ON daily_checkins(user_id, created_at DESC);
