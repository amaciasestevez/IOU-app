import { Router, Request, Response, NextFunction } from 'express';
import db from '../db';
import { authenticateToken } from '../middleware/auth';

const router = Router();

interface Contact {
  id: number;
  owner_id: number;
  name: string;
  email?: string;
  phone?: string;
  linked_user_id?: number;
  created_at?: string;
}

// GET /api/v1/contacts
router.get('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owner_id = (req as any).user.id;
    const result = await db.query<Contact>('SELECT * FROM contacts WHERE owner_id = $1 ORDER BY name ASC', [owner_id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/contacts
router.post('/', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owner_id = (req as any).user.id;
    const { name, email, phone }: Pick<Contact, 'name' | 'email' | 'phone'> = req.body;

    if (!name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }
    if (!email && !phone) {
      res.status(400).json({ message: 'Either email or phone is required' });
      return;
    }

    const text = 'INSERT INTO contacts (owner_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING *';
    const result = await db.query<Contact>(text, [owner_id, name, email || null, phone || null]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/contacts/:id
router.delete('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owner_id = (req as any).user.id;
    const { id } = req.params;
    await db.query('DELETE FROM contacts WHERE id = $1 AND owner_id = $2', [id, owner_id]);
    res.json({ message: 'Contact deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
