import { getDb, closeDb } from './src/config/database';
import { logger } from './src/utils/logger';

async function forceMapping() {
  const db = getDb();
  try {
    const jid = '60989173194924@lid';
    const phone = '628113244321';
    
    await db.query(`
      INSERT INTO wa_jid_mappings (jid, phone_number)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE phone_number = ?
    `, [jid, phone, phone]);

    logger.info(`✅ Manually mapped LID ${jid} to PN ${phone}`);
  } catch (err: any) {
    logger.error('❌ Manual mapping failed: ' + err.message);
  } finally {
    await closeDb();
    process.exit(0);
  }
}

forceMapping();
