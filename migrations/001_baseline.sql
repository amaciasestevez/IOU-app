-- ============================================================
-- IOU — 001_baseline.sql
-- ============================================================
-- This file is the SOURCE OF TRUTH for the database schema.
-- Running it against an EMPTY database reproduces the schema
-- exactly as it exists today. Nothing aspirational lives here:
-- if the database doesn't have it, this file doesn't claim it.
--
-- Usage (fresh database only — this does not migrate an
-- existing one):
--   createdb iou_app
--   psql -d iou_app -f migrations/001_baseline.sql
--
-- Generated from `pg_dump --schema-only` on 2026-09-18, then
-- cleaned: psql meta-commands removed, session SET block
-- removed, `public.` prefixes stripped, sequences collapsed
-- back into SERIAL.
--
-- STRUCTURE NOTE: tables are created first, foreign keys last.
-- This is deliberate, not stylistic. transactions references
-- group_expense_splits, which references group_expenses, which
-- references groups. There is no table ordering that lets every
-- foreign key be declared inline. Creating all tables first and
-- then wiring the references sidesteps the problem entirely.
-- ============================================================


-- ============================================================
-- TABLES
-- ============================================================

-- Every registered account. Login is by email (case-insensitive,
-- enforced by users_email_lower_idx below, not by a UNIQUE
-- constraint on the column itself).
-- `password` holds a bcrypt hash, never plaintext.
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    email      VARCHAR(100) NOT NULL,
    password   VARCHAR(100) NOT NULL,
    first_name VARCHAR(50)  NOT NULL,
    last_name  VARCHAR(50)  NOT NULL
);


-- A person as recorded in ONE user's private address book.
-- Contacts are not shared: if A and B both track each other,
-- that is two separate rows with opposite owner_id values.
--
-- linked_user_id connects a contact to a real account when one
-- exists. This is what makes group debt mirroring possible —
-- findOrCreateLinkedContact() looks a contact up by
-- (owner_id, linked_user_id) and creates one if missing.
-- It stays NULL for contacts who have no IOU account.
CREATE TABLE contacts (
    id             SERIAL PRIMARY KEY,
    owner_id       INTEGER      NOT NULL,
    name           VARCHAR(100) NOT NULL,
    email          VARCHAR(255),
    phone          VARCHAR(20),
    linked_user_id INTEGER,
    created_at     TIMESTAMP DEFAULT NOW(),

    -- A contact with neither email nor phone is unreachable and
    -- therefore useless. At least one is required.
    CONSTRAINT must_have_email_or_phone
        CHECK (email IS NOT NULL OR phone IS NOT NULL)
);


-- Shared-expense groups (roommates, trips). Soft-deleted:
-- DELETE /groups/:id sets deleted_at rather than removing the
-- row, so expense history survives. Every read path must filter
-- on `deleted_at IS NULL`.
CREATE TABLE groups (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    created_by  INTEGER      NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    description TEXT,

    -- NOTE: this is the only timestamptz in the schema — the
    -- rest are plain timestamp. Unintentional inconsistency
    -- left over from when this column was added separately.
    deleted_at  TIMESTAMP WITH TIME ZONE
);


-- Join table: which users belong to which groups, and in what
-- capacity. Stores user_id (not contact_id) on purpose, so a
-- future Phase 2 permissions model is a visibility change
-- rather than a schema rewrite.
CREATE TABLE group_members (
    id        SERIAL PRIMARY KEY,
    group_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    joined_at TIMESTAMP DEFAULT NOW(),

    -- Admins can add/remove members and edit the group. The
    -- last admin cannot be removed (enforced in application
    -- code, not here).
    role      VARCHAR(10) NOT NULL DEFAULT 'member',

    -- 'invited' exists for a future invitation flow; every row
    -- is currently created as 'active'.
    status    VARCHAR(10) NOT NULL DEFAULT 'active',

    CONSTRAINT chk_member_role
        CHECK (role IN ('admin', 'member')),
    CONSTRAINT group_members_status_check
        CHECK (status IN ('active', 'invited')),

    -- One membership row per person per group.
    UNIQUE (group_id, user_id)
);


-- One shared expense: somebody paid, and it gets divided among
-- members. The division itself lives in group_expense_splits.
CREATE TABLE group_expenses (
    id          SERIAL PRIMARY KEY,
    group_id    INTEGER       NOT NULL,

    -- Who fronted the money. Not necessarily who created the row.
    paid_by     INTEGER       NOT NULL,

    amount      NUMERIC(10,2) NOT NULL,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),

    -- 'equal' divides evenly with the remainder cent assigned to
    -- the payer; 'custom' takes explicit per-person amounts that
    -- must sum to `amount`.
    split_type  VARCHAR(10) NOT NULL DEFAULT 'equal',

    CONSTRAINT chk_split_type
        CHECK (split_type IN ('equal', 'custom'))
);


-- One person's share of one expense. The payer gets a row too,
-- inserted with is_paid = true, since they don't owe themselves.
--
-- is_paid here is the GROUP's view of settlement. The dashboard
-- does not read it — see the note on transactions below.
CREATE TABLE group_expense_splits (
    id           SERIAL PRIMARY KEY,
    expense_id   INTEGER       NOT NULL,
    user_id      INTEGER       NOT NULL,
    share_amount NUMERIC(10,2) NOT NULL,
    is_paid      BOOLEAN DEFAULT false,
    paid_at      TIMESTAMP
);


-- A single debt on ONE user's personal ledger.
--
-- direction is written from the row owner's perspective:
--   'i_lent'     -> the contact owes this user
--   'i_borrowed' -> this user owes the contact
--
-- Every read filters by user_id, so a debt between two accounts
-- needs TWO rows — one 'i_lent' on the creditor's ledger, one
-- 'i_borrowed' on the debtor's — or only one side would ever
-- see it.
--
-- group_expense_split_id is NULL for ordinary personal debts.
-- When set, this row is a materialized copy of a group split,
-- and both mirrored rows share the same value. That shared id
-- is what lets group settlement find and update both at once.
-- Group-linked rows are also blocked from direct payment via
-- POST /transactions/:id/payments.
--
-- CAUTION: is_paid is NOT what the dashboard reads. Balances are
-- computed as amount - SUM(payments.amount), so a debt is only
-- "settled" as far as the UI is concerned once payments rows
-- exist for it. Two representations of one fact; keep both
-- updated together.
CREATE TABLE transactions (
    id                     SERIAL PRIMARY KEY,
    amount                 NUMERIC(10,2) NOT NULL,
    description            TEXT,
    is_paid                BOOLEAN   DEFAULT false,
    date                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id                INTEGER       NOT NULL,
    contact_id             INTEGER       NOT NULL,
    direction              VARCHAR(10)   NOT NULL,
    group_expense_split_id INTEGER,

    CONSTRAINT transactions_direction_check
        CHECK (direction IN ('i_lent', 'i_borrowed'))
);

-- Append-only record of money actually moving against a debt.
-- Supports partial payments: several rows can point at one
-- transaction, and the debt is fully settled when they sum to
-- the transaction's amount. This table drives every balance
-- figure in the app.
CREATE TABLE payments (
    id             SERIAL PRIMARY KEY,
    transaction_id INTEGER       NOT NULL,
    amount         NUMERIC(10,2) NOT NULL,
    paid_at        TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- INDEXES
-- ============================================================
-- Indexes don't change what data is valid — only how fast it is
-- found. Each one below covers a column the app filters on in a
-- hot path.

-- Enforces case-insensitive email uniqueness. A plain
-- UNIQUE(email) would let test@x.com and TEST@x.com coexist;
-- indexing lower(email) prevents that. Registration lowercases
-- before inserting, and login must lowercase before comparing.
CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));

-- GET /contacts filters by owner_id on every dashboard load.
CREATE INDEX idx_contacts_owner_id ON contacts (owner_id);

-- GET /transactions filters by user_id on every dashboard load.
CREATE INDEX idx_transactions_user_id ON transactions (user_id);

-- The balance query LEFT JOINs payments on transaction_id.
CREATE INDEX idx_payments_transaction_id ON payments (transaction_id);


-- ============================================================
-- FOREIGN KEYS
-- ============================================================
-- Declared here rather than inline because of the circular
-- reference noted at the top of this file.
--
-- READ THE ON DELETE BEHAVIOR CAREFULLY. Where none is given,
-- Postgres defaults to NO ACTION: deleting the referenced row
-- is REFUSED while children exist. That is the current state of
-- most of these, and it is not necessarily intentional — see
-- 002 for the deliberate pass over delete semantics.

-- contacts -> users
-- Both NO ACTION. Deleting a user with contacts, or who is
-- linked as someone else's contact, currently fails.
ALTER TABLE contacts
    ADD CONSTRAINT contacts_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE contacts
    ADD CONSTRAINT contacts_linked_user_id_fkey
    FOREIGN KEY (linked_user_id) REFERENCES users(id);


-- groups -> users
ALTER TABLE groups
    ADD CONSTRAINT groups_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id);


-- group_members -> groups, users
-- Both CASCADE: membership is meaningless without the group or
-- the person, so those rows are cleaned up automatically.
ALTER TABLE group_members
    ADD CONSTRAINT group_members_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

ALTER TABLE group_members
    ADD CONSTRAINT group_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;


-- group_expenses -> groups, users
-- Deleting a group removes its expenses. Deleting the payer is
-- refused (NO ACTION).
ALTER TABLE group_expenses
    ADD CONSTRAINT group_expenses_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

ALTER TABLE group_expenses
    ADD CONSTRAINT group_expenses_paid_by_fkey
    FOREIGN KEY (paid_by) REFERENCES users(id);


-- group_expense_splits -> group_expenses, users
ALTER TABLE group_expense_splits
    ADD CONSTRAINT group_expense_splits_expense_id_fkey
    FOREIGN KEY (expense_id) REFERENCES group_expenses(id) ON DELETE CASCADE;

ALTER TABLE group_expense_splits
    ADD CONSTRAINT group_expense_splits_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id);


-- transactions -> users, contacts, group_expense_splits
--
-- contact_id is NOT NULL with NO ACTION, which means deleting a
-- contact who has any transactions is rejected by the database.
-- The DELETE /contacts/:id route does not currently handle that
-- failure — known bug, listed in 002.
--
-- The CASCADE on group_expense_split_id means deleting a group
-- expense removes the split, which removes BOTH mirrored
-- transaction rows. That is intended, but it deletes rows from
-- a user's personal ledger as a side effect of a group action.
ALTER TABLE transactions
    ADD CONSTRAINT transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE transactions
    ADD CONSTRAINT transactions_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id);

ALTER TABLE transactions
    ADD CONSTRAINT transactions_group_expense_split_id_fkey
    FOREIGN KEY (group_expense_split_id)
    REFERENCES group_expense_splits(id) ON DELETE CASCADE;


-- payments -> transactions
-- CASCADE: payment history has no meaning without its debt.
ALTER TABLE payments
    ADD CONSTRAINT payments_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;