import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/contacts — List contacts
router.get('/', async (_req: Request, res: Response) => {
  // TODO: Phase 5 - Task 5.1
  res.json({ success: true, data: [], message: 'Contact list (not yet implemented)' });
});

// POST /api/contacts — Add contact
router.post('/', async (_req: Request, res: Response) => {
  // TODO: Phase 5 - Task 5.1
  res.json({ success: true, message: 'Add contact (not yet implemented)' });
});

// POST /api/contacts/import — Import CSV
router.post('/import', async (_req: Request, res: Response) => {
  // TODO: Phase 5 - Task 5.2
  res.json({ success: true, message: 'Import contacts (not yet implemented)' });
});

// POST /api/contacts/sync-laravel — Sync from Laravel DB
router.post('/sync-laravel', async (_req: Request, res: Response) => {
  // TODO: Phase 5 - Task 5.3
  res.json({ success: true, message: 'Sync Laravel contacts (not yet implemented)' });
});

// DELETE /api/contacts/:id — Delete contact
router.delete('/:id', async (_req: Request, res: Response) => {
  // TODO: Phase 5 - Task 5.1
  res.json({ success: true, message: 'Delete contact (not yet implemented)' });
});

export default router;
