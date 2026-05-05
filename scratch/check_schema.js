const { getDb } = require('./src/config/database');
const dotenv = require('dotenv');
dotenv.config();

async function check() {
  const db = getDb();
  try {
    const [rows] = await db.query('DESC wa_chats');
    console.log('--- Columns ---');
    console.table(rows);
    
    const [indexes] = await db.query('SHOW INDEX FROM wa_chats');
    console.log('--- Indexes ---');
    console.table(indexes);
  } catch (err) {
    console.error(err);
  }
  process.exit();
}

check();
