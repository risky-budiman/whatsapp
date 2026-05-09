import { getDb } from '../src/config/database';

async function checkSchema() {
  try {
    const db = getDb();
    console.log('--- SCHEMA CHECK: wa_message_logs ---');
    const [cols]: any = await db.query('DESCRIBE wa_message_logs');
    console.table(cols);
    
    console.log('\n--- DATA CHECK: wa_message_logs (Last 5) ---');
    const [rows]: any = await db.query('SELECT * FROM wa_message_logs ORDER BY created_at DESC LIMIT 5');
    console.table(rows);

    process.exit(0);
  } catch (err: any) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

checkSchema();
