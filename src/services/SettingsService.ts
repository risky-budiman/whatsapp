import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { env } from '../config/env';

class SettingsService {
  private liveChatEnabled: boolean = true;
  private apiKey: string = '';

  async init() {
    try {
      const db = getDb();
      
      // 1. Live Chat Settings
      const [chatRows]: any = await db.query("SELECT value FROM wa_settings WHERE `key` = 'live_chat_enabled'");
      if (chatRows.length > 0) {
        this.liveChatEnabled = chatRows[0].value === 'true';
      } else {
        await db.query("INSERT INTO wa_settings (`key`, value) VALUES ('live_chat_enabled', 'true')");
      }

      // 2. API Key Settings
      const [keyRows]: any = await db.query("SELECT value FROM wa_settings WHERE `key` = 'api_key'");
      if (keyRows.length > 0) {
        this.apiKey = keyRows[0].value;
      } else {
        // Migration: use key from env if first time, else random
        this.apiKey = env.API_KEY || crypto.randomBytes(24).toString('hex');
        await db.query("INSERT INTO wa_settings (`key`, value) VALUES ('api_key', ?)", [this.apiKey]);
        logger.info(`🔑 API Key initialized in Database.`);
      }

      logger.info(`⚙️ Settings loaded: Live Chat ${this.liveChatEnabled ? 'ON' : 'OFF'}`);
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

  async regenerateApiKey(): Promise<string> {
    const newKey = crypto.randomBytes(24).toString('hex');
    try {
      const db = getDb();
      await db.query("UPDATE wa_settings SET value = ? WHERE `key` = 'api_key'", [newKey]);
      this.apiKey = newKey;
      logger.info(`🔑 API Key has been regenerated.`);
      return newKey;
    } catch (err) {
      logger.error(`❌ Gagal regenerate API Key: ${err}`);
      throw err;
    }
  }

  getApiKey(): string {
    return this.apiKey;
  }

  isLiveChatEnabled(): boolean {
    return this.liveChatEnabled;
  }
}

export const settingsService = new SettingsService();
