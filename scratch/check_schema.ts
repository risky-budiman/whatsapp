import { getDb } from '../src/config/database';

async function checkSchema() {
  const db = getDb();
  const [rows] = await db.query('DESCRIBE wa_contacts');
  console.log('wa_contacts schema:', rows);
}

checkSchema().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
