import { getDb, closeDb } from './config/database';
import { logger } from './utils/logger';

async function cleanup() {
  console.log('🧹 Memulai migrasi JID (@lid) ke Nomor Telepon (@s.whatsapp.net)...');
  try {
    const db = getDb();
    
    // 1. Ambil semua mapping yang tersedia
    const [mappings]: any = await db.query("SELECT jid, phone_number FROM wa_jid_mappings");
    console.log(`🔍 Ditemukan ${mappings.length} pemetaan JID.`);

    let migrated = 0;
    for (const map of mappings) {
      const targetPhone = `${map.phone_number.split(':')[0]}@s.whatsapp.net`;
      
      // Update wa_contacts yang masih pakai LID
      const [res]: any = await db.query(
        "UPDATE wa_contacts SET phone_number = ? WHERE phone_number = ?",
        [targetPhone, map.jid]
      );

      // Update wa_chats yang masih pakai LID
      await db.query(
        "UPDATE wa_chats SET phone_number = ? WHERE phone_number = ?",
        [targetPhone, map.jid]
      );

      if (res.affectedRows > 0) migrated++;
    }

    // 2. Hapus sisa-sisa LID yang tidak punya mapping (biasanya sampah sync)
    const [resDel]: any = await db.query("DELETE FROM wa_contacts WHERE phone_number LIKE '%@lid'");
    
    console.log(`✅ Berhasil memigrasi ${migrated} kontak ke format @s.whatsapp.net.`);
    console.log(`🗑️ Berhasil menghapus ${resDel.affectedRows} ID sampah yang tidak valid.`);

    console.log('\n✨ Migrasi Selesai! Halaman Kontak Anda sekarang bersih.');
  } catch (err: any) {
    console.error('❌ Gagal melakukan migrasi:', err.message);
  } finally {
    await closeDb();
    process.exit(0);
  }
}

cleanup();
