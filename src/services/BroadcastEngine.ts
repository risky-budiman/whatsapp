import { getDb } from '../config/database';
import { queueMessage } from './QueueService';
import { processMessage } from '../utils/contentVariation';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class BroadcastEngine {
  /**
   * Start or resume a campaign
   * Reads pending messages and pushes them to BullMQ
   */
  async startCampaign(campaignId: string): Promise<void> {
    const db = getDb();

    // 1. Validate campaign
    const [rows] = await db.query(
      'SELECT * FROM wa_campaigns WHERE id = ?',
      [campaignId]
    );
    const campaign = (rows as any[])[0];

    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    if (campaign.status === 'completed') {
      throw new Error(`Campaign ${campaignId} is already completed`);
    }

    // 2. Mark campaign as running
    await db.query(
      "UPDATE wa_campaigns SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = ?",
      [campaignId]
    );
    logger.info(`🚀 Campaign [${campaign.name}] started/resumed`);

    // 3. Get pending messages
    const [msgRows] = await db.query(
      "SELECT * FROM wa_campaign_messages WHERE campaign_id = ? AND status IN ('pending', 'failed') AND retry_count < max_retries",
      [campaignId]
    );
    const messages = msgRows as any[];

    if (messages.length === 0) {
      logger.info(`ℹ️ Campaign [${campaign.name}] has no pending messages. Marking as completed.`);
      await db.query(
        "UPDATE wa_campaigns SET status = 'completed', completed_at = NOW() WHERE id = ?",
        [campaignId]
      );
      return;
    }

    // 4. Push to Queue
    let queuedCount = 0;
    const variationPool = typeof campaign.variation_pool === 'string' 
      ? JSON.parse(campaign.variation_pool) 
      : campaign.variation_pool;

    for (const msg of messages) {
      // Create message content with variables and variation
      const variables = {
        nama: msg.target_name || '',
        phone: msg.target_phone || '',
      };
      
      const finalContent = processMessage(campaign.template_message, variables, variationPool);

      // Update message status to queued
      await db.query(
        "UPDATE wa_campaign_messages SET status = 'queued', message_content = ? WHERE id = ?",
        [finalContent, msg.id]
      );

      // Push to BullMQ
      await queueMessage({
        messageId: msg.id,
        campaignId: campaignId,
        targetPhone: msg.target_phone,
        messageContent: finalContent,
      });

      queuedCount++;
    }

    logger.info(`📤 Campaign [${campaign.name}]: Pushed ${queuedCount} messages to queue`);
  }

  /**
   * Pause a running campaign
   */
  async pauseCampaign(campaignId: string): Promise<void> {
    const db = getDb();
    
    // We only update status to paused. 
    // Messages already in BullMQ queue might still process, but we can't easily recall them safely without complex queue management.
    // For now, updating status to paused prevents further batches if we implement chunking later.
    await db.query(
      "UPDATE wa_campaigns SET status = 'paused' WHERE id = ? AND status = 'running'",
      [campaignId]
    );
    
    // Note: To fully pause, we would ideally pause the BullMQ queue globally or filter at the worker level.
    // To keep anti-ban linear, we let currently queued jobs finish.
    logger.info(`⏸️ Campaign ${campaignId} paused (currently queued messages will still send)`);
  }

  /**
   * Prepare a new campaign from raw data
   */
  async createCampaign(data: {
    name: string;
    template: string;
    recipients: Array<{ phone: string; name?: string }>;
    variationPool?: any;
    createdBy?: string;
  }): Promise<string> {
    const db = getDb();
    const campaignId = uuidv4();

    // 1. Insert Campaign
    await db.query(
      `INSERT INTO wa_campaigns (id, name, template_message, variation_pool, total_recipients, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        campaignId, 
        data.name, 
        data.template, 
        JSON.stringify(data.variationPool || null), 
        data.recipients.length,
        data.createdBy || 'api'
      ]
    );

    // 2. Insert Recipients
    // Optimizing with bulk insert if array is large
    const values: any[] = [];
    let query = 'INSERT INTO wa_campaign_messages (id, campaign_id, target_phone, target_name) VALUES ';
    const placeholders: string[] = [];

    for (const rec of data.recipients) {
      const msgId = uuidv4();
      placeholders.push('(?, ?, ?, ?)');
      values.push(msgId, campaignId, rec.phone, rec.name || null);
    }

    if (values.length > 0) {
      query += placeholders.join(', ');
      await db.query(query, values);
    }

    logger.info(`📝 Campaign [${data.name}] created with ${data.recipients.length} recipients`);
    return campaignId;
  }

  /**
   * Resend failed messages for a specific campaign
   */
  async resendFailed(campaignId: string): Promise<number> {
    const db = getDb();
    
    // 1. Reset failed messages back to pending
    const [result]: any = await db.query(
      "UPDATE wa_campaign_messages SET status = 'pending', retry_count = 0 WHERE campaign_id = ? AND status = 'failed'",
      [campaignId]
    );

    if (result.affectedRows === 0) {
      throw new Error('No failed messages found to resend');
    }

    // 2. Set campaign back to running status if it was completed or failed
    await db.query(
      "UPDATE wa_campaigns SET status = 'running', completed_at = NULL WHERE id = ?",
      [campaignId]
    );

    // 3. Trigger the engine to process these messages
    await this.startCampaign(campaignId);

    return result.affectedRows;
  }
}

// Singleton
let instance: BroadcastEngine | null = null;
export function getBroadcastEngine(): BroadcastEngine {
  if (!instance) {
    instance = new BroadcastEngine();
  }
  return instance;
}
