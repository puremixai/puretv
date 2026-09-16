-- ============================================
-- 播放记录增加 is_anime 字段（追番订阅/继续观看识别）
-- ============================================

ALTER TABLE play_records ADD COLUMN is_anime INTEGER DEFAULT 0;
