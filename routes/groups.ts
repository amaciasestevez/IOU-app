import { Router, Request, Response, NextFunction } from 'express';
import db from '../db';
import { authenticateToken, isValidAmount } from '../middleware/auth';

const router = Router();

// --- Shared types ---
interface Group {
  id: number;
  name: string;
  description?: string;
  created_by: number;
  created_at: string;
  deleted_at?: string | null;
}

interface GroupMember {
  id: number;
  group_id: number;
  user_id: number;
  role: 'admin' | 'member';
  joined_at: string;
  username?: string;
}

interface GroupExpense {
  id: number;
  group_id: number;
  paid_by: number;
  amount: number;
  description?: string;
  split_type: 'equal' | 'custom';
  created_at: string;
}

interface GroupExpenseSplit {
  id: number;
  expense_id: number;
  user_id: number;
  share_amount: number;
  is_paid: boolean;
  paid_at?: string | null;
}

interface SplitInput {
  user_id: number;
  share_amount: number;
}

// --- Helpers ---

// Verify the requesting user is a member of the group; returns the membership row or sends 403
async function requireMember(req: Request, res: Response, groupId: number): Promise<GroupMember | null> {
  const userId = (req as any).user.id;
  const result = await db.query<GroupMember>(
    'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (result.rows.length === 0) {
    res.status(403).json({ message: 'You are not a member of this group' });
    return null;
  }
  return result.rows[0];
}

// Verify the requesting user is an admin of the group
async function requireAdmin(req: Request, res: Response, groupId: number): Promise<GroupMember | null> {
  const membership = await requireMember(req, res, groupId);
  if (!membership) return null;
  if (membership.role !== 'admin') {
    res.status(403).json({ message: 'Only group admins can perform this action' });
    return null;
  }
  return membership;
}

// --- Group CRUD ---

// GET /api/v1/groups — list all groups the authenticated user belongs to
router.get('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const result = await db.query<Group>(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND g.deleted_at IS NULL
       ORDER BY g.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/groups — create a group; auto-add creator as admin
router.post('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { name, description } = req.body;

    if (!name || String(name).trim() === '') {
      res.status(400).json({ message: 'Group name is required' });
      return;
    }

    const groupResult = await db.query<Group>(
      'INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), description || null, userId]
    );
    const group = groupResult.rows[0];

    // Auto-add creator as admin
    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [group.id, userId, 'admin']
    );

    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/groups/:id — group detail with members
router.get('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    const groupResult = await db.query<Group>(
      'SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL',
      [groupId]
    );
    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: 'Group not found' });
      return;
    }

    const membersResult = await db.query<GroupMember & { username: string }>(
      `SELECT gm.*, u.username FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [groupId]
    );

    res.json({ ...groupResult.rows[0], members: membersResult.rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/groups/:id — update name/description (admin only)
router.put('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const admin = await requireAdmin(req, res, groupId);
    if (!admin) return;

    const { name, description } = req.body;
    if (!name || String(name).trim() === '') {
      res.status(400).json({ message: 'Group name is required' });
      return;
    }

    const result = await db.query<Group>(
      'UPDATE groups SET name = $1, description = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING *',
      [name.trim(), description || null, groupId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/groups/:id — soft delete (admin only)
router.delete('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const admin = await requireAdmin(req, res, groupId);
    if (!admin) return;

    await db.query(
      'UPDATE groups SET deleted_at = NOW() WHERE id = $1',
      [groupId]
    );
    res.json({ message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Group Members ---

// GET /api/v1/groups/:id/members
router.get('/:id/members', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    const result = await db.query<GroupMember & { username: string; email: string }>(
      `SELECT gm.*, u.username, u.email FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/groups/:id/members — add a member by user_id
router.post('/:id/members', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const admin = await requireAdmin(req, res, groupId);
    if (!admin) return;
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ message: 'Email is required' });
      return;
    }

    const userCheck = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length === 0) {
      res.status(404).json({ message: 'No account found with that email' });
      return;
    }

    const user_id = userCheck.rows[0].id;


    // Check not already a member
    const memberCheck = await db.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user_id]
    );
    if (memberCheck.rows.length > 0) {
      res.status(409).json({ message: 'User is already a member of this group' });
      return;
    }

    const result = await db.query<GroupMember>(
      'INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [groupId, user_id, 'member', 'active']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/groups/:id/members/:memberId — remove a member (admin only; block if last admin)
router.delete('/:id/members/:memberId', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const memberUserId = parseInt(String(req.params.memberId));
    const admin = await requireAdmin(req, res, groupId);
    if (!admin) return;

    // Prevent removing the last admin
    const targetMember = await db.query<GroupMember>(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, memberUserId]
    );
    if (targetMember.rows.length === 0) {
      res.status(404).json({ message: 'Member not found in this group' });
      return;
    }

    if (targetMember.rows[0].role === 'admin') {
      const adminCount = await db.query<{ count: string }>(
        "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = 'admin'",
        [groupId]
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        res.status(400).json({ message: 'Cannot remove the last admin from a group' });
        return;
      }
    }

    await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, memberUserId]);
    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
});

// --- Group Expenses ---

// GET /api/v1/groups/:id/expenses
router.get('/:id/expenses', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    const result = await db.query<GroupExpense & { paid_by_username: string }>(
      `SELECT ge.*, u.username AS paid_by_username
       FROM group_expenses ge
       JOIN users u ON ge.paid_by = u.id
       WHERE ge.group_id = $1
       ORDER BY ge.created_at DESC`,
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/groups/:id/expenses — log a group expense with splits
router.post('/:id/expenses', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    const { paid_by, amount, description, split_type = 'equal', splits } = req.body;

    if (!paid_by || !amount) {
      res.status(400).json({ message: 'paid_by and amount are required' });
      return;
    }
    if (!isValidAmount(amount)) {
      res.status(400).json({ message: 'Amount must be a positive number' });
      return;
    }
    if (!['equal', 'custom'].includes(split_type)) {
      res.status(400).json({ message: 'split_type must be equal or custom' });
      return;
    }

    // Verify paid_by is a group member
    const payerCheck = await db.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, paid_by]
    );
    if (payerCheck.rows.length === 0) {
      res.status(400).json({ message: 'paid_by user is not a member of this group' });
      return;
    }

    // Get all member user_ids
    const membersResult = await db.query<{ user_id: number }>(
      'SELECT user_id FROM group_members WHERE group_id = $1',
      [groupId]
    );
    const memberIds = membersResult.rows.map(r => r.user_id);
    const totalAmount = parseFloat(amount);

    let splitRows: SplitInput[] = [];

    if (split_type === 'equal') {
      const perPerson = Math.floor((totalAmount / memberIds.length) * 100) / 100;
      const remainder = Math.round((totalAmount - perPerson * memberIds.length) * 100) / 100;

      splitRows = memberIds.map((uid, i) => ({
        user_id: uid,
        // payer gets any remainder cent
        share_amount: uid === paid_by && remainder > 0
          ? parseFloat((perPerson + remainder).toFixed(2))
          : parseFloat(perPerson.toFixed(2)),
      }));
    } else {
      // custom split
      if (!Array.isArray(splits) || splits.length === 0) {
        res.status(400).json({ message: 'splits array is required for custom split_type' });
        return;
      }

      const splitTotal = splits.reduce((sum: number, s: SplitInput) => sum + parseFloat(String(s.share_amount)), 0);
      if (Math.abs(splitTotal - totalAmount) > 0.01) {
        res.status(400).json({ message: `Split amounts must sum to total (got ${splitTotal.toFixed(2)}, expected ${totalAmount.toFixed(2)})` });
        return;
      }

      splitRows = splits.map((s: SplitInput) => ({
        user_id: s.user_id,
        share_amount: parseFloat(String(s.share_amount)),
      }));
    }

    // Insert expense
    const expenseResult = await db.query<GroupExpense>(
      'INSERT INTO group_expenses (group_id, paid_by, amount, description, split_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [groupId, paid_by, totalAmount, description || null, split_type]
    );
    const expense = expenseResult.rows[0];

    // Insert splits (payer's own split is recorded as already paid)
    for (const split of splitRows) {
      const isPayer = split.user_id === paid_by;
      await db.query(
        'INSERT INTO group_expense_splits (expense_id, user_id, share_amount, is_paid, paid_at) VALUES ($1, $2, $3, $4, $5)',
        [expense.id, split.user_id, split.share_amount, isPayer, isPayer ? new Date().toISOString() : null]
      );
    }

    // Return the expense with its splits
    const splitsResult = await db.query<GroupExpenseSplit & { username: string }>(
      `SELECT ges.*, u.username FROM group_expense_splits ges
       JOIN users u ON ges.user_id = u.id
       WHERE ges.expense_id = $1`,
      [expense.id]
    );

    res.status(201).json({ ...expense, splits: splitsResult.rows });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/groups/:id/expenses/:expenseId
router.delete('/:id/expenses/:expenseId', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const expenseId = parseInt(String(req.params.expenseId));
    const userId = (req as any).user.id;

    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    // Only admin or the payer can delete an expense
    const expenseCheck = await db.query<GroupExpense>(
      'SELECT * FROM group_expenses WHERE id = $1 AND group_id = $2',
      [expenseId, groupId]
    );
    if (expenseCheck.rows.length === 0) {
      res.status(404).json({ message: 'Expense not found' });
      return;
    }

    const expense = expenseCheck.rows[0];
    if (membership.role !== 'admin' && expense.paid_by !== userId) {
      res.status(403).json({ message: 'Only admins or the payer can delete an expense' });
      return;
    }

    await db.query('DELETE FROM group_expenses WHERE id = $1', [expenseId]);
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    next(err);
  }
});

// --- Balances ---

// GET /api/v1/groups/:id/balances — net "who owes whom" summary
router.get('/:id/balances', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    // Get raw unsettled debts: debtor owes creditor share_amount
    const rawResult = await db.query<{
      debtor_id: number;
      debtor_name: string;
      creditor_id: number;
      creditor_name: string;
      amount: string;
    }>(
      `SELECT
         ges.user_id           AS debtor_id,
         u_debtor.username     AS debtor_name,
         ge.paid_by            AS creditor_id,
         u_creditor.username   AS creditor_name,
         ges.share_amount      AS amount
       FROM group_expenses ge
       JOIN group_expense_splits ges ON ge.id = ges.expense_id
       JOIN users u_debtor   ON ges.user_id = u_debtor.id
       JOIN users u_creditor ON ge.paid_by  = u_creditor.id
       WHERE ge.group_id = $1
         AND ges.user_id  != ge.paid_by
         AND ges.is_paid  = false`,
      [groupId]
    );

    // Net debts between each pair in JS
    // Key: "lowerId-higherId", value: signed amount (positive = lower owes higher)
    const netMap: Record<string, { debtor_id: number; debtor_name: string; creditor_id: number; creditor_name: string; amount: number }> = {};

    for (const row of rawResult.rows) {
      const amt = parseFloat(row.amount);
      const lo = Math.min(row.debtor_id, row.creditor_id);
      const hi = Math.max(row.debtor_id, row.creditor_id);
      const key = `${lo}-${hi}`;

      if (!netMap[key]) {
        netMap[key] = { debtor_id: lo, debtor_name: '', creditor_id: hi, creditor_name: '', amount: 0 };
      }

      // positive = lo owes hi, negative = hi owes lo
      const sign = row.debtor_id === lo ? 1 : -1;
      netMap[key].amount += sign * amt;

      // keep names updated for whichever direction has a non-zero balance
      if (row.debtor_id === lo) {
        netMap[key].debtor_name = row.debtor_name;
        netMap[key].creditor_name = row.creditor_name;
      } else {
        netMap[key].debtor_name = row.creditor_name;
        netMap[key].creditor_name = row.debtor_name;
      }
    }

    // Convert to final list, flipping direction when amount is negative
    const balances = Object.values(netMap)
      .filter(b => Math.abs(b.amount) > 0.001)
      .map(b => {
        if (b.amount > 0) {
          return {
            debtor_id: b.debtor_id,
            debtor_name: b.debtor_name,
            creditor_id: b.creditor_id,
            creditor_name: b.creditor_name,
            amount: parseFloat(b.amount.toFixed(2)),
          };
        } else {
          return {
            debtor_id: b.creditor_id,
            debtor_name: b.creditor_name,
            creditor_id: b.debtor_id,
            creditor_name: b.debtor_name,
            amount: parseFloat(Math.abs(b.amount).toFixed(2)),
          };
        }
      });

    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// --- Splits ---

// PUT /api/v1/groups/:id/expenses/:expenseId/splits/:splitId — mark a split as settled
router.put('/:id/expenses/:expenseId/splits/:splitId', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groupId = parseInt(String(req.params.id));
    const expenseId = parseInt(String(req.params.expenseId));
    const splitId = parseInt(String(req.params.splitId));

    const membership = await requireMember(req, res, groupId);
    if (!membership) return;

    // Verify expense belongs to the group
    const expenseCheck = await db.query<GroupExpense>(
      'SELECT id FROM group_expenses WHERE id = $1 AND group_id = $2',
      [expenseId, groupId]
    );
    if (expenseCheck.rows.length === 0) {
      res.status(404).json({ message: 'Expense not found in this group' });
      return;
    }

    const result = await db.query<GroupExpenseSplit>(
      'UPDATE group_expense_splits SET is_paid = true, paid_at = NOW() WHERE id = $1 AND expense_id = $2 RETURNING *',
      [splitId, expenseId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Split not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
