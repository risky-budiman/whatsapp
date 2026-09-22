import { Worker, Job } from 'bullmq';
import { MESSAGE_QUEUE_NAME } from '../services/QueueService';
import { getRedisConfig } from '../config/redis';
import { getSessionManager } from '../services/SessionManager';
import { getAntiBanEngine } from '../services/AntiBanEngine';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { toWhatsAppJid } from '../utils/phone';
import { v4 as uuidv4 } from 'uuid';

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
      const { messageId, campaignId, sessionId: requestedSessionId, targetPhone, messageContent, mode = 'safe' } = job.data;
      const db = getDb();
      const sm = getSessionManager();
      const antiBan = getAntiBanEngine();

      logger.info(`⚙️ Worker processing message ${messageId} for ${targetPhone} (Mode: ${mode})`);

      try {
        // 1. Mark as sending (only if part of a campaign)
        if (campaignId) {
          await db.query(
            "UPDATE wa_campaign_messages SET status = 'sending' WHERE id = ?",
            [messageId]
          );
        }

        // 2. Get next available session (Specific requested session OR best active session with rotation)
        let activeSession = null;
        let selectedSessionId: string | null = null;
        let selectedSessionName: string = 'WhatsApp';

        if (requestedSessionId && requestedSessionId !== 'auto' && requestedSessionId !== 'string') {
          activeSession = sm.getSession(requestedSessionId);
          if (activeSession && activeSession.info.status === 'active') {
            selectedSessionId = activeSession.info.id;
            selectedSessionName = activeSession.info.name;
          }
        }
        if (!selectedSessionId) {
          const best = sm.getBestSession();
          if (best) {
            selectedSessionId = best.id;
            selectedSessionName = best.name;
          }
        }

        if (!selectedSessionId) {
          throw new Error('No active sessions available or daily limits reached');
        }

        const sessionId = selectedSessionId;
        const sessionName = selectedSessionName;

        // 3. Apply Rest Logic (Check if we need to rest because batch limit reached, only in safe mode)
        if (mode === 'safe') {
          await antiBan.checkAndApplyRest();
        }

        // 4. Format JID
        const jid = toWhatsAppJid(targetPhone);

        // 5. Send Message (Handles typing and optional onWhatsApp validation)
        const isFast = mode === 'fast';
        const result: any = await sm.sendMessage(sessionId, jid, messageContent, {
          typing: !isFast,
          checkExists: true
        });
        const waMessageId = result?.id?._serialized || result?.id?.id || null;

        // 6. Log success and update DB
        if (campaignId) {
          // Update message status
          await db.query(
            "UPDATE wa_campaign_messages SET status = 'sent', sent_at = NOW(), session_id = ? WHERE id = ?",
            [sessionId, messageId]
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

        // Record in wa_chats for Live Chat UI and wa_message_logs for history
        const chatId = messageId || uuidv4();
        await db.query(`
          INSERT INTO wa_chats (id, session_id, phone_number, message_id, message_text, is_from_me, status)
          VALUES (?, ?, ?, ?, ?, true, 'sent')
          ON DUPLICATE KEY UPDATE status = 'sent', message_id = VALUES(message_id)
        `, [chatId, sessionId, targetPhone, waMessageId, messageContent]);

        await db.query(
          "INSERT INTO wa_message_logs (id, session_id, campaign_id, target_phone, message_content, direction, status, metadata) VALUES (UUID(), ?, ?, ?, ?, 'outgoing', 'sent', ?)",
          [sessionId, campaignId || null, targetPhone, messageContent, JSON.stringify({ waMessageId, mode })]
        );

        logger.info(`✅ Sent message ${messageId} via ${sessionName}`);

        // 7. Apply jitter delay BEFORE processing the next message in queue
        if (mode === 'safe') {
          await antiBan.applyJitter();
        } else {
          // Fast mode: minimal 1-2s delay between messages to not flood socket
          await antiBan.applyJitter(1, 2);
        }

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
