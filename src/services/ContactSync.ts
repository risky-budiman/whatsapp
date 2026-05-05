import { getDb, getLaravelDb } from '../config/database';
import { logger } from '../utils/logger';
import { normalizePhone } from '../utils/phone';
import { v4 as uuidv4 } from 'uuid';

export class ContactSync {
  /**
   * Sync active customers from Laravel's 'customers' table to WA Gateway
   * Only imports customers with valid phone numbers and is_active = true
   */
  async syncFromLaravel(): Promise<{ added: number; updated: number; total: number }> {
    logger.info('🔄 Starting contact sync from Laravel database...');
    
    try {
      const laravelDb = getLaravelDb();
      const gatewayDb = getDb();

      // Get customers from Laravel (Assumption: customers table exists with phone and name)
      // Adjust column names if they differ in your exact laravel_radius schema
      const [rows] = await laravelDb.query(`
        SELECT id, name, phone, is_active 
        FROM customers 
        WHERE phone IS NOT NULL AND phone != '' AND is_active = 1
      `);
      
      const customers = rows as any[];
      let added = 0;
      let updated = 0;

      for (const customer of customers) {
        const normalizedPhone = normalizePhone(customer.phone);
        
        if (!normalizedPhone) continue;

        // Check if exists in gateway DB (check numeric or full JID)
        const jidFormat = `${normalizedPhone}@c.us`;
        const [existing] = await gatewayDb.query(
          'SELECT id, name, phone_number FROM wa_contacts WHERE phone_number = ? OR phone_number = ?',
          [normalizedPhone, jidFormat]
        );
        const contact = (existing as any[])[0];

        if (contact) {
          // Update if name changed
          if (contact.name !== customer.name) {
            await gatewayDb.query(
              'UPDATE wa_contacts SET name = ?, laravel_customer_id = ?, source = ? WHERE phone_number = ?',
              [customer.name, customer.id, 'laravel_sync', contact.phone_number]
            );
            updated++;
          }
        } else {
          // Insert new
          await gatewayDb.query(
            'INSERT INTO wa_contacts (id, phone_number, name, source, laravel_customer_id) VALUES (?, ?, ?, ?, ?)',
            [uuidv4(), normalizedPhone, customer.name, 'laravel_sync', customer.id]
          );
          added++;
        }
      }

      logger.info(`✅ Sync complete. Added: ${added}, Updated: ${updated}, Total valid: ${customers.length}`);
      return { added, updated, total: customers.length };

    } catch (err: any) {
      logger.error(`❌ Sync failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Handle incoming messages to detect Opt-Out keywords
   * Keywords: STOP, BERHENTI, UNSUBSCRIBE
   */
  async handleIncomingMessage(phone: string, text: string): Promise<void> {
    const normalizedPhone = normalizePhone(phone);
    const upperText = text.trim().toUpperCase();

    const optOutKeywords = ['STOP', 'BERHENTI', 'UNSUBSCRIBE', 'BATAL'];

    if (optOutKeywords.includes(upperText)) {
      const db = getDb();
      
      // Update contact as opted out
      await db.query(
        'UPDATE wa_contacts SET is_opted_out = 1, opted_out_at = NOW() WHERE phone_number = ?',
        [normalizedPhone]
      );
      
      logger.warn(`🚫 Contact ${normalizedPhone} OPTED OUT via keyword`);
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
