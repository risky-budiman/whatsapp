import { getDb } from '../src/config/database';

async function checkCampaigns() {
  try {
    const db = getDb();
    
    console.log('=== CAMPAIGNS ===');
    const [campaigns]: any = await db.query(
      'SELECT id, name, status, total_recipients, sent_count, failed_count, created_at, started_at FROM wa_campaigns ORDER BY created_at DESC LIMIT 5'
    );
    console.table(campaigns);

    if (campaigns.length > 0) {
      const latestCampaignId = campaigns[0].id;
      console.log(`\n=== MESSAGES FOR LATEST CAMPAIGN (${campaigns[0].name}) ===`);
      const [messages]: any = await db.query(
        'SELECT id, target_phone, target_name, status, error_message, retry_count, sent_at, updated_at FROM wa_campaign_messages WHERE campaign_id = ? ORDER BY created_at ASC',
        [latestCampaignId]
      );
      console.table(messages);
    }
    
    process.exit(0);
  } catch (err: any) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

checkCampaigns();
