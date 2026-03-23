-- IOU Manager — Initial Schema
-- Run once against a fresh database:
--   psql -d iou_app -f migrations/001_initial_schema.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(100) NOT NULL UNIQUE,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Contacts (private per user)
CREATE TABLE IF NOT EXISTS contacts (
  id             SERIAL PRIMARY KEY,
  owner_id       INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255),
  phone          VARCHAR(50),
  linked_user_id INT          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT chk_contact_info CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id          SERIAL PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id  INT          REFERENCES contacts(id) ON DELETE SET NULL,
  direction   VARCHAR(20)  NOT NULL CHECK (direction IN ('i_lent', 'i_borrowed')),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  is_paid     BOOLEAN      NOT NULL DEFAULT false,
  date        TIMESTAMPTZ  DEFAULT NOW()
);

-- Payments (partial payment audit trail)
CREATE TABLE IF NOT EXISTS payments (
  id             SERIAL PRIMARY KEY,
  transaction_id INT           NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL CHECK (name <> ''),
  description TEXT,
  created_by  INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ  -- soft delete
);

-- Group Members
CREATE TABLE IF NOT EXISTS group_members (
  id        SERIAL PRIMARY KEY,
  group_id  INT         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

-- Group Expenses
CREATE TABLE IF NOT EXISTS group_expenses (
  id          SERIAL PRIMARY KEY,
  group_id    INT           NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  split_type  VARCHAR(10)   NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom')),
  created_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- Group Expense Splits
CREATE TABLE IF NOT EXISTS group_expense_splits (
  id           SERIAL PRIMARY KEY,
  expense_id   INT           NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  user_id      INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_amount NUMERIC(12,2) NOT NULL CHECK (share_amount > 0),
  is_paid      BOOLEAN       NOT NULL DEFAULT false,
  paid_at      TIMESTAMPTZ,
  UNIQUE (expense_id, user_id)
);
