import express, { Request, Response } from 'express';
import db from './db';
import bcrypt from 'bcrypt';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- Types ---

interface User {
  id: number;
  username: string;
  email: string;
  password: string;
}

interface Transaction {
  id: number;
  lender_id: number;
  borrower_id: number;
  amount: number;
  description: string;
  is_paid: boolean;
  borrower_name?: string;
  lender_name?: string;
}

interface DebtResult {
  sum: string | null;
}

// --- User Routes ---

app.get('/users', async (_req: Request, res: Response) => {
  const result = await db.query<User>('SELECT * FROM users');
  res.json(result.rows);
});

app.post('/users', async (req: Request, res: Response) => {
  const { username, email }: Pick<User, 'username' | 'email'> = req.body;
  const text = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *';
  const result = await db.query<User>(text, [username, email, 'temp_password']);
  res.json(result.rows[0]);
});

app.get('/users/:id/debt', async (req: Request, res: Response) => {
  const { id } = req.params;
  const text = 'SELECT SUM(amount) FROM transactions WHERE borrower_id = $1 AND is_paid = false';
  const result = await db.query<DebtResult>(text, [id]);
  res.json(result.rows[0]);
});

app.post('/register', async (req: Request, res: Response) => {
  const { username, email, password }: Pick<User, 'username' | 'email' | 'password'> = req.body;

  // 1. Hash the password before saving it - 10 is the number of salt rounds
  const hashedPassword = await bcrypt.hash(password, 10);

  // 2. Save the hashed password, NOT the original
  const text = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email';
  const result = await db.query<Omit<User, 'password'>>(text, [username, email, hashedPassword]);

  res.json({ message: 'Account created successfully!', user: result.rows[0] });
});

app.post('/login', async (req: Request, res: Response) => {
  const { username, password }: Pick<User, 'username' | 'password'> = req.body;

  if (!username || !password || username.trim() === '' || password.trim() === '') {
    res.status(400).json({ message: 'Username and password are required' });
    return;
  }

  // 1. Find the user by username only - we can't search by password anymore
  //    because the stored one is hashed and we don't know what it is yet
  const text = 'SELECT * FROM users WHERE username = $1';
  const result = await db.query<User>(text, [username]);

  if (result.rows.length === 0) {
    res.status(401).json({ message: 'Invalid username or password' });
    return;
  }

  // 2. We found the user - now compare what they typed against the stored hash
  const user = result.rows[0];
  const passwordMatch = await bcrypt.compare(password, user.password);

  if (passwordMatch) {
    res.json({ message: 'Login successful!', user: user });
  } else {
    res.status(401).json({ message: 'Invalid username or password' });
  }
});

// --- Transaction Routes ---

app.get('/transactions', async (_req: Request, res: Response) => {
  const query = `
    SELECT t.*, u1.username AS borrower_name, u2.username AS lender_name
    FROM transactions t
    JOIN users u1 ON t.borrower_id = u1.id
    JOIN users u2 ON t.lender_id = u2.id;
  `;
  const result = await db.query<Transaction>(query);
  res.json(result.rows);
});

app.post('/transactions', async (req: Request, res: Response) => {
  const { lender_id, borrower_id, amount, description }: Omit<Transaction, 'id' | 'is_paid'> = req.body;
  const text = 'INSERT INTO transactions (lender_id, borrower_id, amount, description) VALUES ($1, $2, $3, $4) RETURNING *';
  const result = await db.query<Transaction>(text, [lender_id, borrower_id, amount, description]);
  res.json(result.rows[0]);
});

app.put('/transactions/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const text = 'UPDATE transactions SET is_paid = true WHERE id = $1 RETURNING *';
  const result = await db.query<Transaction>(text, [id]);
  res.json(result.rows);
});

app.delete('/transactions/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  await db.query('DELETE FROM transactions WHERE id = $1', [id]);
  res.json({ message: 'Deleted successfully' });
});

// --- Start Server ---

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
