-- IOU Manager — Groups schema additions
-- Adds columns needed for Phase 1 groups feature.
-- Safe to run on existing databases (uses IF NOT EXISTS / conditional adds).

-- groups: add description and soft-delete column
ALTER TABLE groups ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- group_members: add role column
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'member';
DO $$ BEGIN
  ALTER TABLE group_members ADD CONSTRAINT chk_member_role CHECK (role IN ('admin', 'member'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- group_expenses: add split_type column
ALTER TABLE group_expenses ADD COLUMN IF NOT EXISTS split_type VARCHAR(10) NOT NULL DEFAULT 'equal';
DO $$ BEGIN
  ALTER TABLE group_expenses ADD CONSTRAINT chk_split_type CHECK (split_type IN ('equal', 'custom'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
