import { Router, Request, Response } from 'express';
import { settingsService } from '../../services/SettingsService';
import { getDb } from '../../config/database';

const router = Router();

// GET /api/settings/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    
    const [sessions]: any = await db.query("SELECT COUNT(*) as count FROM wa_sessions WHERE status = 'active'");
    const [contacts]: any = await db.query("SELECT COUNT(*) as count FROM wa_contacts");
    const [messages]: any = await db.query("SELECT COUNT(*) as count FROM wa_message_logs WHERE DATE(created_at) = CURDATE()");
    const [broadcasts]: any = await db.query("SELECT COUNT(*) as count FROM wa_campaigns WHERE status = 'completed'");

    res.json({
      success: true,
      data: {
        activeSessions: sessions[0].count,
        totalContacts: contacts[0].count,
        messagesToday: messages[0].count,
        totalBroadcasts: broadcasts[0].count
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/settings
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      liveChatEnabled: settingsService.isLiveChatEnabled(),
      apiKey: settingsService.getApiKey()
    }
  });
});

// POST /api/settings/regenerate-api-key
router.post('/regenerate-api-key', async (req: Request, res: Response) => {
  try {
    const newKey = await settingsService.regenerateApiKey();
    res.json({ success: true, message: 'API Key regenerated', data: { apiKey: newKey } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/settings
router.post('/', (req: Request, res: Response) => {
  const { liveChatEnabled } = req.body;
  if (typeof liveChatEnabled === 'boolean') {
    settingsService.setLiveChatStatus(liveChatEnabled);
  }
  res.json({ success: true, message: 'Settings updated' });
});

export default router;
