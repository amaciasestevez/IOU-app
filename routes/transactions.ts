import { Router, Request, Response, NextFunction } from 'express';
import db from '../db';
import { authenticateToken, isValidAmount } from '../middleware/auth';

const router = Router();

interface Transaction {
  id: number;
  user_id: number;
  contact_id: number;
  direction: 'i_lent' | 'i_borrowed';
  amount: number;
  remaining: number;
  total_paid: number;
  last_paid_at: string;
  description: string;
  is_paid: boolean;
  contact_name?: string;
}

interface Payment {
  id: number;
  transaction_id: number;
  amount: number;
  paid_at: string;
}

interface Contact {
  id: number;
  owner_id: number;
}

interface DebtResult {
  sum: string | null;
}

// GET /api/v1/transactions
router.get('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user.id;
    const query = `
      SELECT t.*, c.name AS contact_name,
      COALESCE(SUM(p.amount), 0) AS total_paid,
      t.amount - COALESCE(SUM(p.amount), 0) AS remaining,
      MAX(p.paid_at) AS last_paid_at
    FROM transactions t
    JOIN contacts c ON t.contact_id = c.id
    LEFT JOIN payments p ON p.transaction_id = t.id
    WHERE t.user_id = $1
    GROUP BY t.id, c.name
    ORDER BY t.date DESC
`;
    const result = await db.query<Transaction>(query, [user_id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/transactions
router.post('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user.id;
    const { contact_id, direction, amount, description }: Pick<Transaction, 'contact_id' | 'direction' | 'amount' | 'description'> = req.body;

    if (!contact_id || !direction || !amount) {
      res.status(400).json({ message: 'Contact, direction and amount are required' });
      return;
    }
    if (!['i_lent', 'i_borrowed'].includes(direction)) {
      res.status(400).json({ message: 'Direction must be i_lent or i_borrowed' });
      return;
    }
    if (!isValidAmount(amount)) {
      res.status(400).json({ message: 'Amount must be a positive number' });
      return;
    }

    const contactCheck = await db.query<Contact>(
      'SELECT id FROM contacts WHERE id = $1 AND owner_id = $2',
      [contact_id, user_id]
    );
    if (contactCheck.rows.length === 0) {
      res.status(403).json({ message: 'Contact not found' });
      return;
    }

    const text = 'INSERT INTO transactions (user_id, contact_id, direction, amount, description) VALUES ($1, $2, $3, $4, $5) RETURNING *';
    const result = await db.query<Transaction>(text, [user_id, contact_id, direction, amount, description]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/transactions/:id
router.put('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user.id;
    const { id } = req.params;
    const result = await db.query<Transaction>(
      'UPDATE transactions SET is_paid = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, user_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/transactions/:id
router.delete('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user.id;
    const { id } = req.params;
    await db.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, user_id]);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/transactions/:id/payments
router.get('/:id/payments', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user.id;
    const { id } = req.params;

    const txnCheck = await db.query<Transaction>(
      'SELECT id FROM transactions WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );
    if (txnCheck.rows.length === 0) {
      res.status(403).json({ message: 'Transaction not found' });
      return;
    }

    const result = await db.query<Payment>('SELECT * FROM payments WHERE transaction_id = $1 ORDER BY paid_at ASC', [id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/transactions/:id/payments
router.post('/:id/payments', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user.id;
    const { id } = req.params;
    const { amount } = req.body;

    if (!isValidAmount(amount)) {
      res.status(400).json({ message: 'Amount must be a positive number' });
      return;
    }

    const txnCheck = await db.query<Transaction>('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (txnCheck.rows.length === 0) {
      res.status(403).json({ message: 'Transaction not found' });
      return;
    }

    const result = await db.query<Payment>('INSERT INTO payments (transaction_id, amount) VALUES ($1, $2) RETURNING *', [id, amount]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/:id/debt (kept for backwards compat)
router.get('/users/:id/debt', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await db.query<DebtResult>(
      'SELECT SUM(amount) FROM transactions WHERE user_id = $1 AND is_paid = false',
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
