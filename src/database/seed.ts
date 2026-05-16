import { getDb, closeDb } from '../config/database';
import { hashPassword } from '../utils/crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

async function seed() {
  console.log('🌱 Starting admin user seed...');
  const db = getDb();

  try {
    // 1. Hapus user admin jika sudah ada untuk menghindari duplikasi
    await db.query("DELETE FROM wa_users WHERE username = 'admin'");
    
    // 2. Buat user admin baru
    const adminId = uuidv4();
    const hashedPassword = hashPassword('admin123');
    
    await db.query(
      "INSERT INTO wa_users (id, username, password, role) VALUES (?, ?, ?, ?)",
      [adminId, 'admin', hashedPassword, 'admin']
    );

    console.log('\n✅ Admin user (admin/admin123) has been reset successfully!');
    console.log('🚀 You can now login using these credentials.');
    
    await closeDb();
    process.exit(0);
  } catch (err: any) {
    console.error(`❌ Seeding failed: ${err.message}`);
    process.exit(1);
  }
}

seed();
