import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET } from '../middleware/auth';

const router = Router();

interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}

function handleUniqueViolation(err: any, res: Response): boolean {
  if (err.code === '23505') {
    if (err.constraint === 'users_email_lower_idx' || err.constraint === 'users_email_key') {
      res.status(409).json({ message: 'An account with this email already exists' });
    } else {
      res.status(409).json({ message: 'Account already exists' });
    }
    return true;
  }
  return false;
}

// POST /api/v1/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { first_name, last_name, email, password }: Pick<User, 'first_name' | 'last_name' | 'email' | 'password'> = req.body;

    if (
      !first_name || !last_name || !email || !password ||
      first_name.trim() === '' || last_name.trim() === '' ||
      email.trim() === '' || password.trim() === ''
    ) {
      res.status(400).json({ message: 'First name, last name, email and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ message: 'Password must be at least 8 characters' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 10);

    const text = 'INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING id, first_name, last_name, email';
    const result = await db.query<Omit<User, 'password'>>(text, [first_name.trim(), last_name.trim(), normalizedEmail, hashedPassword]);

    res.json({ message: 'Account created successfully!', user: result.rows[0] });
  } catch (err: any) {
    if (handleUniqueViolation(err, res)) return;
    next(err);
  }
});

// POST /api/v1/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password }: Pick<User, 'email' | 'password'> = req.body;

    if (!email || !password || email.trim() === '' || password.trim() === '') {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await db.query<User>('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);

    if (result.rows.length === 0) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, first_name: user.first_name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ message: 'Login successful!', token, first_name: user.first_name, last_name: user.last_name });
  } catch (err: any) {
    if (handleUniqueViolation(err, res)) return;
    next(err);
  }
});

export default router;