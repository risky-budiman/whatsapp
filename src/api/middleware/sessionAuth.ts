import { Request, Response, NextFunction } from 'express';
import { getDb } from '../../config/database';
import { logger } from '../../utils/logger';

/**
 * Middleware to protect routes that require a valid web session
 */
export async function sessionAuth(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies?.wa_sid;

  // Bypass for local development if needed, but better to keep it strict
  // if (req.headers['x-api-key']) return next(); 

  if (!sid) {
    return res.status(401).json({ success: false, message: 'Unauthorized: No session found' });
  }

  try {
    const db = getDb();
    const [sessions]: any = await db.query(`
      SELECT user_id FROM wa_web_sessions 
      WHERE sid = ? AND expires_at > NOW()
    `, [sid]);

    if (sessions.length === 0) {
      res.clearCookie('wa_sid');
      return res.status(401).json({ success: false, message: 'Unauthorized: Session expired' });
    }

    // Add user info to request for downstream use
    (req as any).userId = sessions[0].user_id;
    next();
  } catch (err: any) {
    logger.error(`Session auth error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error during authentication' });
  }
}
