import { getDb, closeDb } from './src/config/database';
import { logger } from './src/utils/logger';

async function fix() {
    try {
        const db = getDb();
        logger.info('🔧 Updating wa_sessions status ENUM...');
        await db.query("ALTER TABLE wa_sessions MODIFY COLUMN status ENUM('connecting','active','disconnected','banned','qr') DEFAULT 'connecting'");
        logger.info('✅ Database updated successfully!');
        process.exit(0);
    } catch (err) {
        logger.error(`❌ Failed to update database: ${err}`);
        process.exit(1);
    }
}

fix();
