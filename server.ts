// importing core libraries - dotenv loads environment variables, express handles the backend, db connects to our database layer, bcrypt handles password hashing
import 'dotenv/config';
import express, { Request, Response } from 'express';
import db from './db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

//creates the express server, tells it to read incoming JSON data from requests, and serve HTML files from the public folder
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Types
//creates the blueprint for what a user object needs to have throughout the app
interface User {
  id: number;
  username: string;
  email: string;
  password: string;
}

//creates the blueprint for what a transaction needs to have - borrower and lender name are optional and could be null
interface Transaction {
  id: number;
  user_id: number;
  contact_id: number;
  direction: 'i_lent' | 'i_borrowed';
  amount: number;
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

//creates the blueprint for the debt result - sum could be null if the user has no debt
interface DebtResult {
  sum: string | null;
}

// blueprint for what a contact object needs to have - email and phone are optional individually but the database enforces at least one must exist
interface Contact {
  id: number;
  owner_id: number;
  name: string;
  email?: string;
  phone?: string;
  linked_user_id?: number;
  created_at?: string;
}

// middleware function that checks every protected route for a valid JWT token before allowing access
function authenticateToken(req: Request, res: Response, next: Function): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
      res.status(401).json({ message: 'Access denied - no token provided' });
      return;
  }

  try {
    // key  line - checks if the token is valid and was signed with secret key
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
      (req as any).user = decoded;
      next();
  } catch {
      res.status(403).json({ message: 'Access denied - invalid token' });
  }
}

// --- User Routes ---
// GET route - grabs all users from the database, more of an admin utility route
app.get('/users', async (_req: Request, res: Response) => {
  const result = await db.query<User>('SELECT * FROM users');
  res.json(result.rows);
});

//POST route - takes username and email from the request and inserts them into the database - $1 $2 $3 are placeholders that get filled in order from the array below to prevent SQL injection
app.post('/users', async (req: Request, res: Response) => {
  const { username, email }: Pick<User, 'username' | 'email'> = req.body;
  const text = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *';
  const result = await db.query<User>(text, [username, email, 'temp_password']);
  res.json(result.rows[0]);
});

//GET route - retrieves everything a specific user currently owes that hasnt been paid back yet and returns the total - :id in the url determines which user we're looking up
app.get('/users/:id/debt',authenticateToken, async (req: Request, res: Response) => {
  const { id } = req.params;
  const text = 'SELECT SUM(amount) FROM transactions WHERE borrower_id = $1 AND is_paid = false';
  const result = await db.query<DebtResult>(text, [id]);
  res.json(result.rows[0]);
});

// POST route - handles new user registration, hashes the password with bcrypt before saving so plain text password never touches the database
app.post('/register', async (req: Request, res: Response) => {
  const { username, email, password }: Pick<User, 'username' | 'email' | 'password'> = req.body;

  //Hash the password before saving it
  const hashedPassword = await bcrypt.hash(password, 10);

  // Save the hashed password
  const text = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email';
  const result = await db.query<Omit<User, 'password'>>(text, [username, email, hashedPassword]);

  res.json({ message: 'Account created successfully!', user: result.rows[0] });
});

//POST route - handles user login, checks for empty fields, looks up user by username only, then uses bcrypt to compare the typed password against the stored hash
app.post('/login', async (req: Request, res: Response) => {
  const { username, password }: Pick<User, 'username' | 'password'> = req.body;

  if (!username || !password || username.trim() === '' || password.trim() === '') {
    res.status(400).json({ message: 'Username and password are required' });
    return;
  }

  //Find the user by username only - we can't search by password anymore because the stored one is hashed and we don't know what it is yet
  const text = 'SELECT * FROM users WHERE username = $1';
  const result = await db.query<User>(text, [username]);

  if (result.rows.length === 0) {
    res.status(401).json({ message: 'Invalid username or password' });
    return;
  }

  // now compare what they typed against the stored hash
  const user = result.rows[0];
  const passwordMatch = await bcrypt.compare(password, user.password);

  if (passwordMatch) {
    const token = jwt.sign(
        { id: user.id, username: user.username }, // payload or data were putting into the token specifically not putting password because insecure.
        process.env.JWT_SECRET as string, // key from .env file and we are saying it is a string
        { expiresIn: '24h' }
    );
    res.json({ message: 'Login successful!', token: token, username: user.username });
} else {
    res.status(401).json({ message: 'Invalid username or password' });
  }
});

// Contact Route
// GET route - retrieves all contacts belonging to the logged in user only
app.get('/contacts', authenticateToken, async (req: Request, res: Response) => {
  const owner_id = (req as any).user.id;
  const result = await db.query<Contact>('SELECT * FROM contacts WHERE owner_id = $1 ORDER BY name ASC', [owner_id]);
  res.json(result.rows);
});

// POST route - creates a new contact for the logged in user
app.post('/contacts', authenticateToken, async (req: Request, res: Response) => {
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
});

// DELETE route - deletes a specific contact belonging to the logged in user
app.delete('/contacts/:id', authenticateToken, async (req: Request, res: Response) => {
  const owner_id = (req as any).user.id;
  const { id } = req.params;
  await db.query('DELETE FROM contacts WHERE id = $1 AND owner_id = $2', [id, owner_id]);
  res.json({ message: 'Contact deleted successfully' });
});


// Transaction Routes
// GET route - retrieves all transactions for the logged in user, joins with contacts to get the contact's name
app.get('/transactions', authenticateToken, async (req: Request, res: Response) => {
  const user_id = (req as any).user.id;
  const query = `
    SELECT t.*, c.name AS contact_name
    FROM transactions t
    JOIN contacts c ON t.contact_id = c.id
    WHERE t.user_id = $1
    ORDER BY t.date DESC
  `;
  const result = await db.query<Transaction>(query, [user_id]);
  res.json(result.rows);
});

// POST route - creates a new transaction for the logged in user
app.post('/transactions', authenticateToken, async (req: Request, res: Response) => {
  const user_id = (req as any).user.id;
  const { contact_id, direction, amount, description }: Pick<Transaction, 'contact_id' | 'direction' | 'amount' | 'description'> = req.body;

  if (!contact_id || !direction || !amount) {
    res.status(400).json({ message: 'Contact, direction and amount are required' });
    return;
  }

  const text = 'INSERT INTO transactions (user_id, contact_id, direction, amount, description) VALUES ($1, $2, $3, $4, $5) RETURNING *';
  const result = await db.query<Transaction>(text, [user_id, contact_id, direction, amount, description]);
  res.json(result.rows[0]);
});

// PUT route - marks a specific transaction as paid
app.put('/transactions/:id', authenticateToken, async (req: Request, res: Response) => {
  const user_id = (req as any).user.id;
  const { id } = req.params;
  const text = 'UPDATE transactions SET is_paid = true WHERE id = $1 AND user_id = $2 RETURNING *';
  const result = await db.query<Transaction>(text, [id, user_id]);
  res.json(result.rows);
});

// DELETE route - deletes a specific transaction belonging to the logged in user
app.delete('/transactions/:id', authenticateToken, async (req: Request, res: Response) => {
  const user_id = (req as any).user.id;
  const { id } = req.params;
  await db.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, user_id]);
  res.json({ message: 'Deleted successfully' });
});

// GET route - fetches all payments for a specific transaction
// payments belonging to transaction with this id
app.get('/transactions/:id/payments', authenticateToken, async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await db.query<Payment>('SELECT * FROM payments WHERE transaction_id = $1 ORDER BY paid_at ASC', [id]);
  res.json(result.rows);
});

// POST route - records a new payment toward a specific transaction
app.post('/transactions/:id/payments', authenticateToken, async (req: Request, res: Response) => {
  const user_id = (req as any).user.id;
  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ message: 'A valid amount is required' });
    return;
  }

  // verify this transaction belongs to the logged in user before allowing payment
  const txnCheck = await db.query<Transaction>('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, user_id]);
  if (txnCheck.rows.length === 0) {
    res.status(403).json({ message: 'Transaction not found' });
    return;
  }

  const text = 'INSERT INTO payments (transaction_id, amount) VALUES ($1, $2) RETURNING *';
  const result = await db.query<Payment>(text, [id, amount]);
  res.json(result.rows[0]);
});

// Start Server

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

