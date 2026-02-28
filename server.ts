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
  lender_id: number;
  borrower_id: number;
  amount: number;
  description: string;
  is_paid: boolean;
  borrower_name?: string;
  lender_name?: string;
}

//creates the blueprint for the debt result - sum could be null if the user has no debt
interface DebtResult {
  sum: string | null;
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

// Transaction Routes
// GET route - grabs all transactions and uses JOIN to combine the users and transactions tables so we get readable usernames instead of just ids
app.get('/transactions', authenticateToken, async (_req: Request, res: Response) => {
  const query = `
    SELECT t.*, u1.username AS borrower_name, u2.username AS lender_name
    FROM transactions t
    JOIN users u1 ON t.borrower_id = u1.id
    JOIN users u2 ON t.lender_id = u2.id;
  `;
  const result = await db.query<Transaction>(query);
  res.json(result.rows);
});

// POST route - takes lender, borrower, amount and description from the request and inserts a new transaction into the database
app.post('/transactions',authenticateToken, async (req: Request, res: Response) => {
  const { lender_id, borrower_id, amount, description }: Omit<Transaction, 'id' | 'is_paid'> = req.body;
  const text = 'INSERT INTO transactions (lender_id, borrower_id, amount, description) VALUES ($1, $2, $3, $4) RETURNING *';
  const result = await db.query<Transaction>(text, [lender_id, borrower_id, amount, description]);
  res.json(result.rows[0]);
});

// PUT route - updates a specific transaction to paid using the id in the url
app.put('/transactions/:id',authenticateToken, async (req: Request, res: Response) => {
  const { id } = req.params;
  const text = 'UPDATE transactions SET is_paid = true WHERE id = $1 RETURNING *';
  const result = await db.query<Transaction>(text, [id]);
  res.json(result.rows);
});

app.delete('/transactions/:id',authenticateToken, async (req: Request, res: Response) => {
  const { id } = req.params;
  await db.query('DELETE FROM transactions WHERE id = $1', [id]);
  res.json({ message: 'Deleted successfully' });
});

// Start Server

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

