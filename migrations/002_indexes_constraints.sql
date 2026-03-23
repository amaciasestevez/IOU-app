-- IOU Manager — Indexes & Constraints
-- Run after 001_initial_schema.sql:
--   psql -d iou_app -f migrations/002_indexes_constraints.sql

-- users
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- contacts
CREATE INDEX IF NOT EXISTS idx_contacts_owner_id       ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email          ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_linked_user_id ON contacts(linked_user_id);

-- transactions
CREATE INDEX IF NOT EXISTS idx_transactions_user_id    ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_contact_id ON transactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_paid  ON transactions(user_id, is_paid);

-- payments
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id);

-- group_members
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id  ON group_members(user_id);

-- group_expenses
CREATE INDEX IF NOT EXISTS idx_group_expenses_group_id ON group_expenses(group_id);

-- group_expense_splits
CREATE INDEX IF NOT EXISTS idx_group_expense_splits_expense_id ON group_expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_group_expense_splits_user_id    ON group_expense_splits(user_id);
