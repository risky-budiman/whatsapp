import { Router, Request, Response } from 'express';
import { getBroadcastEngine } from '../../services/BroadcastEngine';
import { getDb } from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Campaigns
 *   description: WhatsApp broadcasting campaigns
 */

/**
 * @swagger
 * /api/campaigns:
 *   get:
 *     summary: List all campaigns
 *     tags: [Campaigns]
 *     responses:
 *       200:
 *         description: List of campaigns
 */
// GET /api/campaigns — List campaigns
router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const [rows] = await db.query('SELECT id, name, status, total_recipients, sent_count, failed_count, scheduled_at, created_at FROM wa_campaigns ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns:
 *   post:
 *     summary: Create a new campaign
 *     tags: [Campaigns]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - template
 *               - recipients
 *             properties:
 *               name:
 *                 type: string
 *               template:
 *                 type: string
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     phone:
 *                       type: string
 *                     name:
 *                       type: string
 *     responses:
 *       200:
 *         description: Campaign created
 */
// POST /api/campaigns — Create campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, template, recipients, variationPool } = req.body;
    
    if (!name || !template || !Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ success: false, message: 'Invalid payload. name, template, and recipients array are required.' });
      return;
    }

    const engine = getBroadcastEngine();
    const campaignId = await engine.createCampaign({
      name,
      template,
      recipients,
      variationPool
    });

    res.json({ success: true, data: { campaignId }, message: 'Campaign created successfully' });
  } catch (err: any) {
    logger.error(`Create campaign error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}:
 *   get:
 *     summary: Get campaign detail
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign detail with messages
 */
// GET /api/campaigns/:id — Campaign detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = getDb();
    
    const [rows] = await db.query('SELECT * FROM wa_campaigns WHERE id = ?', [id]);
    const campaign = (rows as any[])[0];
    
    if (!campaign) {
      res.status(404).json({ success: false, message: 'Campaign not found' });
      return;
    }

    const [msgRows] = await db.query('SELECT target_phone, target_name, status, error_message, sent_at FROM wa_campaign_messages WHERE campaign_id = ?', [id]);
    
    res.json({ 
      success: true, 
      data: {
        ...campaign,
        messages: msgRows
      } 
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}/start:
 *   post:
 *     summary: Start campaign broadcast
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Campaign started
 */
// POST /api/campaigns/:id/start — Start broadcast
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    await engine.startCampaign(id);
    
    res.json({ success: true, message: 'Campaign started and messages queued' });
  } catch (err: any) {
    logger.error(`Start campaign error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/campaigns/:id/pause — Pause broadcast
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    await engine.pauseCampaign(id);
    
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/campaigns/:id/resume — Resume broadcast
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const engine = getBroadcastEngine();
    await engine.startCampaign(id); // start handles resume logic
    
    res.json({ success: true, message: 'Campaign resumed' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/campaigns/{id}/progress:
 *   get:
 *     summary: Get campaign progress via SSE
 *     tags: [Campaigns]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE stream for progress
 */
// GET /api/campaigns/:id/progress — Progress SSE stream
router.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = getDb();
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send progress every 3 seconds
    const interval = setInterval(async () => {
      try {
        const [rows] = await db.query(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status IN ('pending', 'queued', 'sending') THEN 1 ELSE 0 END) as pending
          FROM wa_campaign_messages 
          WHERE campaign_id = ?
        `, [id]);
        
        const stats = (rows as any[])[0];
        res.write(`data: ${JSON.stringify(stats)}\n\n`);
      } catch (err) {
        // ignore interval errors
      }
    }, 3000);

    req.on('close', () => clearInterval(interval));

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
