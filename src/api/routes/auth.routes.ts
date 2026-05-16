import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../config/database';
import { hashPassword, verifyPassword, generateToken } from '../../utils/crypto';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
 */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  try {
    const db = getDb();
    const [users]: any = await db.query('SELECT * FROM wa_users WHERE username = ?', [username]);

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = users[0];
    const isValid = verifyPassword(password, user.password);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Create session
    const sid = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.query('INSERT INTO wa_web_sessions (sid, user_id, expires_at) VALUES (?, ?, ?)', [
      sid,
      user.id,
      expiresAt
    ]);

    // Set cookie
    res.cookie('wa_sid', sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err: any) {
    logger.error(`Login error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user info
 *     tags: [Auth]
 */
router.get('/me', async (req: Request, res: Response) => {
  const sid = req.cookies?.wa_sid;

  if (!sid) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const db = getDb();
    const [sessions]: any = await db.query(`
      SELECT s.*, u.username, u.role 
      FROM wa_web_sessions s
      JOIN wa_users u ON s.user_id = u.id
      WHERE s.sid = ? AND s.expires_at > NOW()
    `, [sid]);

    if (sessions.length === 0) {
      return res.status(401).json({ success: false, message: 'Session expired or invalid' });
    }

    const session = sessions[0];
    res.json({
      success: true,
      user: {
        id: session.user_id,
        username: session.username,
        role: session.role
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout
 *     tags: [Auth]
 */
router.post('/logout', async (req: Request, res: Response) => {
  const sid = req.cookies?.wa_sid;
  if (sid) {
    const db = getDb();
    await db.query('DELETE FROM wa_web_sessions WHERE sid = ?', [sid]).catch(() => {});
  }
  res.clearCookie('wa_sid');
  res.json({ success: true });
});

/**
 * @swagger
 * /api/auth/profile:
 *   patch:
 *     summary: Update current user profile
 *     tags: [Auth]
 */
router.patch('/profile', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { username, password } = req.body;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

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

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    values.push(userId);
    await db.query(`UPDATE wa_users SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
