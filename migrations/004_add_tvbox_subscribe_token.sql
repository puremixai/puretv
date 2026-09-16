-- ============================================
-- 添加 TVBox 订阅 token 字段
-- 版本: 004
-- 创建时间: 2026-02-25
-- ============================================

-- 为 users 表添加 tvbox_subscribe_token 字段
ALTER TABLE users ADD COLUMN tvbox_subscribe_token TEXT;

-- 创建索引以加速 token 查询
CREATE INDEX IF NOT EXISTS idx_users_tvbox_token ON users(tvbox_subscribe_token) WHERE tvbox_subscribe_token IS NOT NULL;
