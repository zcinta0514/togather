-- 结果页、定案和活动详情都按目的地筛选投票。
CREATE INDEX IF NOT EXISTS votes_destination_idx ON votes(destination_id);
