import { getDb } from './src/config/database';

async function migrate() {
  const db = getDb();
  try {
    await db.query("ALTER TABLE wa_sessions ADD COLUMN is_enabled TINYINT(1) DEFAULT 1;");
    console.log("Migration successful: Added is_enabled column to wa_sessions");
  } catch (err: any) {
    if (err.code === 'ER_DUP_COLUMN_NAME') {
      console.log("Column is_enabled already exists.");
    } else {
      console.error("Migration failed:", err);
    }
  }
  process.exit(0);
}

migrate();
