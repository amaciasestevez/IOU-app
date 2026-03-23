import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET } from '../middleware/auth';

const router = Router();

interface User {
  id: number;
  username: string;
  email: string;
  password: string;
}

// POST /api/v1/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email, password }: Pick<User, 'username' | 'email' | 'password'> = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ message: 'Username, email and password are required' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const text = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email';
    const result = await db.query<Omit<User, 'password'>>(text, [username, email, hashedPassword]);

    res.json({ message: 'Account created successfully!', user: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      if (err.constraint === 'users_email_key') {
        res.status(409).json({ message: 'An account with this email already exists' });
      } else {
        res.status(409).json({ message: 'Username already taken' });
      }
      return;
    }
    next(err);
  }
});

// POST /api/v1/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password }: Pick<User, 'username' | 'password'> = req.body;

    if (!username || !password || username.trim() === '' || password.trim() === '') {
      res.status(400).json({ message: 'Username and password are required' });
      return;
    }

    const result = await db.query<User>('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      res.status(401).json({ message: 'Invalid username or password' });
      return;
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
      const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.json({ message: 'Login successful!', token, username: user.username });
    } else {
      res.status(401).json({ message: 'Invalid username or password' });
    }
  } catch (err: any) {
    if (err.code === '23505') {
      if (err.constraint === 'users_email_key') {
        res.status(409).json({ message: 'An account with this email already exists' });
      } else {
        res.status(409).json({ message: 'Username already taken' });
      }
      return;
    }
    next(err);
  }
});

export default router;
