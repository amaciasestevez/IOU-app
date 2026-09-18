-- ============================================================
-- IOU — 002_constraints_and_integrity.sql
-- ============================================================


BEGIN;



-- 1. POSITIVE AMOUNT CONSTRAINTS
-- The app validates amounts in isValidAmount() before inserting,
-- but application-layer validation only protects the paths that
-- go through the application. A direct psql insert, a future
-- script, a second service, or a bug in a new route all bypass
-- it. A CHECK constraint cannot be bypassed.
--
-- Zero is excluded as well as negatives: a debt of $0.00 is not
-- a debt, and a $0.00 payment is not a payment.

ALTER TABLE transactions
    ADD CONSTRAINT chk_transactions_amount_positive
    CHECK (amount > 0);

ALTER TABLE payments
    ADD CONSTRAINT chk_payments_amount_positive
    CHECK (amount > 0);

ALTER TABLE group_expenses
    ADD CONSTRAINT chk_group_expenses_amount_positive
    CHECK (amount > 0);

ALTER TABLE group_expense_splits
    ADD CONSTRAINT chk_group_expense_splits_share_positive
    CHECK (share_amount > 0);


-- ============================================================
-- 2. ONE SPLIT PER PERSON PER EXPENSE
-- ============================================================
-- POST /groups/:id/expenses builds splits by iterating over
-- group members, so duplicates shouldn't occur. But nothing
-- currently PREVENTS them: a retried request, a bug in the
-- custom-split path (which takes user_ids straight from the
-- request body), or a malformed payload sending the same
-- user_id twice would each create a second split row.
--
-- A duplicate split would silently double that person's share
-- of one expense, and — because splits are now materialized
-- into transactions — double the debt on both ledgers. This is
-- exactly the kind of quiet financial corruption a constraint
-- should make impossible.

ALTER TABLE group_expense_splits
    ADD CONSTRAINT group_expense_splits_expense_id_user_id_key
    UNIQUE (expense_id, user_id);


-- ============================================================
-- 3. is_paid IS NEVER UNKNOWN
-- ============================================================
-- Both columns already DEFAULT false, but were declared
-- nullable, so an explicit `is_paid = NULL` insert is currently
-- legal. NULL in a boolean means "unknown", and "we don't know
-- whether this debt is paid" is not a state this app has any
-- way to represent or resolve. It also breaks WHERE clauses
-- silently: `WHERE is_paid = false` does NOT match NULL rows.

ALTER TABLE transactions
    ALTER COLUMN is_paid SET NOT NULL;

ALTER TABLE group_expense_splits
    ALTER COLUMN is_paid SET NOT NULL;


-- ============================================================
-- 4. ACCOUNT DELETION (SOFT DELETE)
-- ============================================================
-- Before this column, deleting a user was impossible in
-- practice: users(id) is referenced from seven places, all with
-- NO ACTION, so the database refuses the delete as soon as the
-- account has any activity. That is not a policy, it's an
-- unhandled foreign key violation with no path forward.
--
-- Hard deletion (CASCADE) was rejected because a users row is
-- referenced by OTHER PEOPLE'S data. If Drake deleted his
-- account and it cascaded, it would remove the 'i_lent' row on
-- your ledger recording that he owes you $33 — one person's
-- account deletion silently rewriting another person's
-- financial history. Unacceptable for a ledger.
--
-- Soft delete keeps every foreign key resolvable: the row still
-- exists, so other users' transactions, group memberships, and
-- expense history stay intact and correct. Same pattern already
-- used for groups.deleted_at.
--
-- NOTE: the schema change alone does nothing. It requires
-- application work to have any effect:
--   - login must reject users WHERE deleted_at IS NOT NULL
--   - POST /groups/:id/members must not find deleted accounts
--     by email
--   - findOrCreateLinkedContact should not link to a deleted
--     account
--   - a DELETE /users/me route needs to exist to set it
-- Until that is written, this column is inert.

ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP;


COMMIT;


-- ============================================================
-- DELIBERATELY NOT CHANGED
-- ============================================================
-- Recording what was considered and rejected, so the absence
-- reads as a decision rather than an oversight.
--
-- CONTACT DELETION: contacts.id is referenced by
-- transactions.contact_id (NOT NULL, NO ACTION), so deleting a
-- contact with any transaction history is refused by the
-- database. That refusal is CORRECT and stays — a debt cannot
-- point at a contact that no longer exists, and cascading would
-- erase financial history.
--
-- The bug is in the route, not the schema: DELETE
-- /contacts/:id reports success even when the delete fails.
-- The fix belongs in contacts.ts — check for existing
-- transactions and return a real error ("Can't remove this
-- contact — you have N unsettled debts with them"). No schema
-- change needed.
--
-- MISSING INDEXES: the old 002_indexes_constraints.sql declared
-- eleven indexes that were never created (contacts.email,
-- contacts.linked_user_id, transactions.contact_id,
-- transactions(user_id, is_paid), group_members.group_id,
-- group_members.user_id, group_expenses.group_id,
-- group_expense_splits.expense_id, group_expense_splits.user_id,
-- and two on users made redundant by users_email_lower_idx).
--
-- Not added here, deliberately. Indexes cost write performance
-- and disk space, and should be added in response to an actual
-- slow query, not speculatively. The four that exist were each
-- added for a known hot path. Revisit when there is enough data
-- for EXPLAIN ANALYZE to say something meaningful.
--
-- COLUMN TYPE INCONSISTENCIES: groups.deleted_at is timestamptz
-- while every other timestamp is plain timestamp; varchar sizes
-- vary (100 vs 255 for emails). Real inconsistencies, but
-- changing column types rewrites the table and risks data
-- conversion issues for no functional gain right now. Left for
-- a future migration with a clear reason behind it.
-- ============================================================