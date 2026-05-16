import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { normalizePhone, toWhatsAppJid } from '../utils/phone';
import { v4 as uuidv4 } from 'uuid';

export class ContactSync {
  /**
   * Handle incoming messages to detect Opt-Out keywords
   * Keywords: STOP, BERHENTI, UNSUBSCRIBE
   */
  async handleIncomingMessage(phone: string, text: string): Promise<void> {
    const jid = toWhatsAppJid(phone);
    const upperText = text.trim().toUpperCase();

    const optOutKeywords = ['STOP', 'BERHENTI', 'UNSUBSCRIBE', 'BATAL'];

    if (optOutKeywords.includes(upperText)) {
      const db = getDb();
      
      // Update contact as opted out
      await db.query(
        'UPDATE wa_contacts SET is_opted_out = 1, opted_out_at = NOW() WHERE phone_number = ?',
        [jid]
      );
      
      logger.warn(`🚫 Contact ${jid} OPTED OUT via keyword`);
    }
  }
}

let instance: ContactSync | null = null;
export function getContactSync(): ContactSync {
  if (!instance) {
    instance = new ContactSync();
  }
  return instance;
}
