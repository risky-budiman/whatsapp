import { getDb } from './src/config/database';
import { logger } from './src/utils/logger';

async function cleanData() {
    try {
        const db = getDb();
        logger.warn('🚨 Memulai pembersihan data...');
        
        await db.query('SET FOREIGN_KEY_CHECKS = 0');
        await db.query('TRUNCATE TABLE wa_chats');
        await db.query('TRUNCATE TABLE wa_contacts');
        await db.query('TRUNCATE TABLE wa_jid_mappings');
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
        
        logger.info('✅ Semua data obrolan dan kontak berhasil dibersihkan!');
        logger.info('🔄 Restart server (npm run dev) dan sistem akan otomatis sinkronisasi ulang dengan WhatsApp Web.');
        process.exit(0);
    } catch (err) {
        logger.error(`Error: ${err}`);
        process.exit(1);
    }
}

cleanData();
