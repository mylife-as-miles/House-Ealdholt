-- Apply through the hosting platform's normal migration workflow.
-- Each day has at most 100 successful reservations, so each JSON identity map
-- has at most 100 hashed keys. Do not alter an applied migration in place.
CREATE TABLE npc_ai_daily_quota (
  day TEXT PRIMARY KEY NOT NULL,
  total INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  minute_total INTEGER NOT NULL,
  user_counts TEXT NOT NULL,
  user_minute_counts TEXT NOT NULL
);
