import { getDb, closeDb } from './src/config/database';
import { logger } from './src/utils/logger';

async function fixSchema() {
  const db = getDb();
  try {
    logger.info('Updating table schema to support full JIDs...');
    
    await db.query('ALTER TABLE wa_contacts MODIFY phone_number VARCHAR(100)');
    await db.query('ALTER TABLE wa_chats MODIFY phone_number VARCHAR(100)');
    await db.query('ALTER TABLE wa_message_logs MODIFY target_phone VARCHAR(100)');
    await db.query('ALTER TABLE wa_campaign_messages MODIFY target_phone VARCHAR(100)');

    logger.info('✅ Schema updated successfully');
  } catch (err: any) {
    logger.error('❌ Schema update failed: ' + err.message);
  } finally {
    await closeDb();
    process.exit(0);
  }
}

fixSchema();
