import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../config/database';
import { hashPassword } from '../../utils/crypto';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * Middleware to check if user is admin
 */
async function isAdmin(req: Request, res: Response, next: any) {
  const userId = (req as any).userId;
  const isApiKey = (req as any).isApiKeyAuth;

  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // If authenticated via System API Key, treat as admin
  if (isApiKey || userId === 'api-key-system') {
    return next();
  }

  const db = getDb();
  const [users]: any = await db.query('SELECT role FROM wa_users WHERE id = ?', [userId]);
  
  if (users.length > 0 && users[0].role === 'admin') {
    return next();
  }
  res.status(403).json({ success: false, message: 'Forbidden: Admin access required' });
}

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all users (Admin only)
 *     tags: [Users]
 */
router.get('/', isAdmin, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [rows]: any = await db.query('SELECT id, username, role, created_at FROM wa_users ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create new user (Admin only)
 *     tags: [Users]
 */
router.post('/', isAdmin, async (req: Request, res: Response) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  try {
    const db = getDb();
    const hashedPassword = hashPassword(password);
    const id = uuidv4();

    await db.query('INSERT INTO wa_users (id, username, password, role) VALUES (?, ?, ?, ?)', [
      id,
      username,
      hashedPassword,
      role || 'staff'
    ]);

    res.json({ success: true, message: 'User created successfully' });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   patch:
 *     summary: Update user (Admin only)
 *     tags: [Users]
 */
router.patch('/:id', isAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, password, role } = req.body;

  try {
    const db = getDb();
    const updates: string[] = [];
    const values: any[] = [];

    if (username) {
      updates.push('username = ?');
      values.push(username);
    }
    if (password) {
      updates.push('password = ?');
      values.push(hashPassword(password));
    }
    if (role) {
      updates.push('role = ?');
      values.push(role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    values.push(id);
    await db.query(`UPDATE wa_users SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'User updated successfully' });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user (Admin only)
 *     tags: [Users]
 */
router.delete('/:id', isAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUserId = (req as any).userId;

  if (id === currentUserId) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
  }

  try {
    const db = getDb();
    await db.query('DELETE FROM wa_users WHERE id = ?', [id]);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
