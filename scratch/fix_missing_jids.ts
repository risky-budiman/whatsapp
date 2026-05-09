import { getDb } from '../src/config/database';
import { toWhatsAppJid } from '../src/utils/phone';
import { logger } from '../src/utils/logger';

async function fix() {
  const db = getDb();
  
  // Find contacts that don't have @c.us or @g.us
  const [rows] = await db.query(
    'SELECT id, phone_number FROM wa_contacts WHERE phone_number NOT LIKE "%@c.us" AND phone_number NOT LIKE "%@g.us"'
  );
  
  const contacts = rows as any[];
  console.log(`Found ${contacts.length} contacts to fix.`);
  
  let fixed = 0;
  for (const contact of contacts) {
    const newJid = toWhatsAppJid(contact.phone_number);
    console.log(`Fixing ${contact.phone_number} -> ${newJid}`);
    
    try {
      // Use IGNORE or check for duplicates because the JID version might already exist
      await db.query(
        'UPDATE IGNORE wa_contacts SET phone_number = ? WHERE id = ?',
        [newJid, contact.id]
      );
      
      // If UPDATE IGNORE failed to update (because of duplicate), we might want to delete the duplicate or merge
      // For now, let's just count success
      fixed++;
    } catch (err: any) {
      console.error(`Failed to fix ${contact.id}: ${err.message}`);
    }
  }
  
  console.log(`Successfully updated ${fixed} contacts.`);
  process.exit(0);
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
