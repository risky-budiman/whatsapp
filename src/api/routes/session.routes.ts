import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/sessions — List all sessions
router.get('/', async (_req: Request, res: Response) => {
  // TODO: Phase 2 - Task 2.8
  res.json({ success: true, data: [], message: 'Session list (not yet implemented)' });
});

// POST /api/sessions — Create new session
router.post('/', async (_req: Request, res: Response) => {
  // TODO: Phase 2 - Task 2.8
  res.json({ success: true, message: 'Create session (not yet implemented)' });
});

// GET /api/sessions/:id/qr — Get QR code stream (SSE)
router.get('/:id/qr', async (_req: Request, res: Response) => {
  // TODO: Phase 2 - Task 2.3
  res.json({ success: true, message: 'QR code (not yet implemented)' });
});

// GET /api/sessions/:id/status — Session status
router.get('/:id/status', async (_req: Request, res: Response) => {
  // TODO: Phase 2 - Task 2.8
  res.json({ success: true, message: 'Session status (not yet implemented)' });
});

// DELETE /api/sessions/:id — Delete session
router.delete('/:id', async (_req: Request, res: Response) => {
  // TODO: Phase 2 - Task 2.8
  res.json({ success: true, message: 'Delete session (not yet implemented)' });
});

// POST /api/sessions/:id/restart — Restart session
router.post('/:id/restart', async (_req: Request, res: Response) => {
  // TODO: Phase 2 - Task 2.8
  res.json({ success: true, message: 'Restart session (not yet implemented)' });
});

export default router;
