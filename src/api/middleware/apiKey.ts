import { Request, Response, NextFunction } from 'express';
import { settingsService } from '../../services/SettingsService';

/**
 * API Key authentication middleware
 * Optimized to allow dashboard access while securing external API calls
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Bypass for Health Check
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  const apiKey = (req.headers['x-api-key'] as string) || (req.query.api_key as string);

  // 2. DASHBOARD-ONLY BYPASS (GET only):
  // Only allow bypass for XHR/fetch calls originating from the Dashboard page (/).
  // Requests from Swagger (/api-docs), Postman, curl, or browser URL bar are NOT bypassed.
  const secFetchDest = req.headers['sec-fetch-dest'] as string;
  const secFetchSite = req.headers['sec-fetch-site'] as string;
  const referer = req.get('referer') || '';

  const isBrowserFetch = secFetchDest === 'empty'; // XHR/fetch, not page navigation
  const isSameOrigin = secFetchSite === 'same-origin';

  // Check that the referer is the Dashboard root page, NOT /api-docs or other pages
  let isDashboardReferer = false;
  try {
    const refererUrl = new URL(referer);
    isDashboardReferer = refererUrl.pathname === '/' || refererUrl.pathname === '';
  } catch {
    isDashboardReferer = false;
  }

  if (isBrowserFetch && isSameOrigin && isDashboardReferer && req.method === 'GET') {
    return next();
  }

  // 3. STRICT VALIDATION: For ALL other requests (Actions, External, Swagger, etc.)
  if (!apiKey) {
    res.status(401).json({
      success: false,
      message: 'Authentication Required. Please provide a valid API Key.',
    });
    return;
  }

  if (apiKey !== settingsService.getApiKey()) {
    res.status(403).json({
      success: false,
      message: 'Invalid API Key.',
    });
    return;
  }

  next();
}
