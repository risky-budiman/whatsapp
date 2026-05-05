import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';

/**
 * API Key authentication middleware
 * Expects header: X-API-Key: <key>
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow health check without auth
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      success: false,
      message: 'Missing API Key. Provide X-API-Key header.',
    });
    return;
  }

  if (apiKey !== env.API_KEY) {
    res.status(403).json({
      success: false,
      message: 'Invalid API Key.',
    });
    return;
  }

  next();
}
