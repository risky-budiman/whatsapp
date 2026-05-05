const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    try {
        const db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('🧹 Memulai Hard Reset Database (Data Only)...');

        // Truncate data tables
        await db.execute('SET FOREIGN_KEY_CHECKS = 0');
        await db.execute('TRUNCATE TABLE wa_chats');
        await db.execute('TRUNCATE TABLE wa_contacts');
        await db.execute('TRUNCATE TABLE wa_jid_mappings');
        await db.execute('SET FOREIGN_KEY_CHECKS = 1');

        console.log('✅ Database dikosongkan (Sesi tetap aman).');
        console.log('🚀 Silakan restart server dan klik "Sync WhatsApp" di dashboard.');
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Gagal membersihkan database:', err.message);
        process.exit(1);
    }
})();
