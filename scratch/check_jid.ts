import { getDb } from '../src/config/database';

async function check() {
  const db = getDb();
  const [rows] = await db.query('SELECT phone_number, source FROM wa_contacts WHERE phone_number NOT LIKE "%@c.us" AND phone_number NOT LIKE "%@g.us"');
  console.log('Contacts without @c.us or @g.us:', rows);
}

check().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
