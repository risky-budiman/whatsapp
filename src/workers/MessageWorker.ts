import { Worker, Job } from 'bullmq';
import { MESSAGE_QUEUE_NAME } from '../services/QueueService';
import { getRedisConfig } from '../config/redis';
import { getSessionManager } from '../services/SessionManager';
import { getAntiBanEngine } from '../services/AntiBanEngine';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { toWhatsAppJid } from '../utils/phone';

let messageWorker: Worker;

/**
 * Initialize BullMQ Worker for message processing
 */
export function initWorker(): void {
  const redisConfig = getRedisConfig();

  // Worker processes 1 job at a time per Node process (concurrency: 1)
  // This is crucial for Anti-Ban to ensure delays and typing are linear
  messageWorker = new Worker(
    MESSAGE_QUEUE_NAME,
    async (job: Job) => {
      const { messageId, campaignId, targetPhone, messageContent } = job.data;
      const db = getDb();
      const sm = getSessionManager();
      const antiBan = getAntiBanEngine();

      logger.info(`⚙️ Worker processing message ${messageId} for ${targetPhone}`);

      try {
        // 1. Mark as sending (only if part of a campaign)
        if (campaignId) {
          await db.query(
            "UPDATE wa_campaign_messages SET status = 'sending' WHERE id = ?",
            [messageId]
          );
        }

        // 2. Get next available session (Rotates automatically & checks daily limit)
        const session = sm.getBestSession();
        if (!session) {
          throw new Error('No active sessions available or daily limits reached');
        }

        // 3. Apply Rest Logic (Check if we need to rest because batch limit reached)
        // Note: For now using default env values, later can be overwritten by campaign config
        await antiBan.checkAndApplyRest();

        // 4. Format JID
        const jid = toWhatsAppJid(targetPhone);

        // 5. Send Message (This handles Typing Simulation internally)
        const success = await sm.sendMessage(session.id, jid, messageContent);

        // 6. Log success and update DB
        if (campaignId) {
          // Update message status
          await db.query(
            "UPDATE wa_campaign_messages SET status = 'sent', sent_at = NOW(), session_id = ? WHERE id = ?",
            [session.id, messageId]
          );

          // Update campaign counters
          await db.query(
            "UPDATE wa_campaigns SET sent_count = sent_count + 1 WHERE id = ?",
            [campaignId]
          );

          // Check if campaign is finished
          const [remaining]: any = await db.query(
            "SELECT COUNT(*) as pending FROM wa_campaign_messages WHERE campaign_id = ? AND status IN ('pending', 'queued', 'sending')",
            [campaignId]
          );
          
          if (remaining[0].pending === 0) {
            await db.query(
              "UPDATE wa_campaigns SET status = 'completed', completed_at = NOW() WHERE id = ?",
              [campaignId]
            );
            logger.info(`🏁 Campaign ${campaignId} MARKED AS COMPLETED`);
          }
        }

        await db.query(
          "INSERT INTO wa_message_logs (id, session_id, campaign_id, target_phone, message_content, direction, status) VALUES (UUID(), ?, ?, ?, ?, 'outgoing', 'sent')",
          [session.id, campaignId || null, targetPhone, messageContent]
        );

        logger.info(`✅ Sent message ${messageId} via ${session.name}`);

        // 7. Apply random delay BEFORE processing the next message in queue
        await antiBan.applyJitter();

      } catch (err: any) {
        // Log failure
        logger.error(`❌ Failed to send message ${messageId}: ${err.message}`);

        if (campaignId) {
          // Update message status
          await db.query(
            "UPDATE wa_campaign_messages SET status = 'failed', error_message = ?, retry_count = retry_count + 1 WHERE id = ?",
            [err.message, messageId]
          );

          // Update campaign counters
          await db.query(
            "UPDATE wa_campaigns SET failed_count = failed_count + 1 WHERE id = ?",
            [campaignId]
          );
        }

        // Re-throw to trigger BullMQ retry backoff
        throw err;
      }
    },
    {
      connection: redisConfig,
      concurrency: 1, // DO NOT change to >1 to maintain anti-ban linearity
    }
  );

  messageWorker.on('error', (err) => {
    logger.error(`❌ Worker Error: ${err.message}`);
  });

  logger.info('👷 Message Worker initialized');
}

/**
 * Gracefully close the worker
 */
export async function closeWorker(): Promise<void> {
  if (messageWorker) {
    await messageWorker.close();
    logger.info('👷 Message Worker closed');
  }
}
