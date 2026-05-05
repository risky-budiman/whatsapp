import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/dashboard/stats — Overall statistics
router.get('/stats', async (_req: Request, res: Response) => {
  // TODO: Phase 6 - Task 6.5
  res.json({
    success: true,
    data: {
      sessions: { total: 0, active: 0, disconnected: 0, banned: 0 },
      campaigns: { total: 0, running: 0, completed: 0 },
      messages: { sent_today: 0, failed_today: 0, total: 0 },
    },
    message: 'Dashboard stats (not yet implemented)',
  });
});

// GET /api/dashboard/logs — Recent logs
router.get('/logs', async (_req: Request, res: Response) => {
  // TODO: Phase 6 - Task 6.5
  res.json({ success: true, data: [], message: 'Logs (not yet implemented)' });
});

export default router;
