import { getDb } from '../config/database';
import { logger } from '../utils/logger';

class SettingsService {
  private liveChatEnabled: boolean = true;

  async init() {
    try {
      const db = getDb();
      const [rows]: any = await db.query("SELECT value FROM wa_settings WHERE `key` = 'live_chat_enabled'");
      if (rows.length > 0) {
        this.liveChatEnabled = rows[0].value === 'true';
        logger.info(`⚙️ Settings loaded: Live Chat is ${this.liveChatEnabled ? 'ON' : 'OFF'}`);
      } else {
        // Default insert
        await db.query("INSERT INTO wa_settings (`key`, value) VALUES ('live_chat_enabled', 'true')");
      }
    } catch (err) {
      logger.warn(`⚠️ Gagal memuat settings dari DB: ${err}`);
    }
  }

  async setLiveChatStatus(status: boolean) {
    this.liveChatEnabled = status;
    try {
      const db = getDb();
      await db.query("UPDATE wa_settings SET value = ? WHERE `key` = 'live_chat_enabled'", [status ? 'true' : 'false']);
      logger.info(`🎚️ Live Chat status updated to: ${status ? 'ON' : 'OFF'}`);
    } catch (err) {
      logger.error(`❌ Gagal menyimpan status Live Chat ke DB: ${err}`);
    }
  }

  isLiveChatEnabled(): boolean {
    return this.liveChatEnabled;
  }
}

export const settingsService = new SettingsService();
