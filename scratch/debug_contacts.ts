import { getDb } from '../src/config/database';

async function debug() {
  const db = getDb();
  const [rows] = await db.query('SELECT * FROM wa_contacts LIMIT 10');
  console.log('Contacts in DB (all):', rows);
  
  const [count] = await db.query('SELECT COUNT(*) as total FROM wa_contacts');
  console.log('Total contacts:', count);
}

debug().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
