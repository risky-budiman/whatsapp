import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/campaigns — List campaigns
router.get('/', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.1
  res.json({ success: true, data: [], message: 'Campaign list (not yet implemented)' });
});

// POST /api/campaigns — Create campaign
router.post('/', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.1
  res.json({ success: true, message: 'Create campaign (not yet implemented)' });
});

// GET /api/campaigns/:id — Campaign detail
router.get('/:id', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.1
  res.json({ success: true, message: 'Campaign detail (not yet implemented)' });
});

// POST /api/campaigns/:id/start — Start broadcast
router.post('/:id/start', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.2
  res.json({ success: true, message: 'Start campaign (not yet implemented)' });
});

// POST /api/campaigns/:id/pause — Pause broadcast
router.post('/:id/pause', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.2
  res.json({ success: true, message: 'Pause campaign (not yet implemented)' });
});

// POST /api/campaigns/:id/resume — Resume broadcast
router.post('/:id/resume', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.2
  res.json({ success: true, message: 'Resume campaign (not yet implemented)' });
});

// GET /api/campaigns/:id/progress — Progress SSE stream
router.get('/:id/progress', async (_req: Request, res: Response) => {
  // TODO: Phase 4 - Task 4.4
  res.json({ success: true, message: 'Campaign progress (not yet implemented)' });
});

export default router;
