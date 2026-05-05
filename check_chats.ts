import { getDb } from './src/config/database';
import { logger } from './src/utils/logger';

async function check() {
    try {
        const db = getDb();
        const [rows]: any = await db.query('SELECT COUNT(*) as total FROM wa_chats');
        logger.info(`Total messages in wa_chats: ${rows[0].total}`);
        
        const [recent]: any = await db.query('SELECT * FROM wa_chats ORDER BY created_at DESC LIMIT 1');
        logger.info(`Latest message: ${JSON.stringify(recent[0])}`);
        
        process.exit(0);
    } catch (err) {
        logger.error(`Error: ${err}`);
        process.exit(1);
    }
}

check();
