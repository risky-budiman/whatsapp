import { getSessionManager } from './src/services/SessionManager';

async function checkContacts() {
  try {
    const sm = getSessionManager();
    // Use timeout to wait for SM to initialize if needed
    const sessions = sm.getAllSessions();
    const active = sessions.find((s: any) => s.status === 'active');
    
    if (!active) {
      console.log('❌ Tidak ada sesi yang aktif. Pastikan server npm run dev menyala dan WhatsApp terhubung.');
      process.exit(1);
    }

    const sessionData = sm.getSession(active.id);
    if (!sessionData) {
      console.log('❌ Data sesi tidak ditemukan.');
      process.exit(1);
    }

    console.log('🔄 Menarik data kontak langsung dari mesin...');
    const contacts = await sessionData.client.getContacts();
    const myContacts = contacts.filter((c: any) => c.isMyContact && !c.isGroup);

    console.log(`\n📊 STATISTIK KONTAK:`);
    console.log(`Total Semua Kontak (Termasuk Grup & Orang Asing): ${contacts.length}`);
    console.log(`Total Kontak Tersimpan di HP (isMyContact): ${myContacts.length}`);

    if (myContacts.length > 0) {
      console.log('\n🔍 CONTOH 1 KONTAK TERSIMPAN DI HP:');
      console.log(JSON.stringify({
        id: myContacts[0].id,
        number: myContacts[0].number,
        name: myContacts[0].name,
        pushname: myContacts[0].pushname,
        shortName: myContacts[0].shortName,
        isMyContact: myContacts[0].isMyContact
      }, null, 2));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

// We need to initialize the DB first because SessionManager uses it
import { initDatabase } from './src/config/database';
initDatabase().then(() => {
  // Wait a bit for SessionManager to potentially load from DB if this was run stand-alone
  // But wait, if we run this via ts-node while npm run dev is running, 
  // SessionManager instances are separate. We can't access the running client!
  console.log('Menjalankan cek independen...');
});
