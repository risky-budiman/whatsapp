import { Queue, QueueEvents } from 'bullmq';
import { getRedisConfig } from '../config/redis';
import { logger } from '../utils/logger';

export const MESSAGE_QUEUE_NAME = 'wa-messages';

let messageQueue: Queue;
let queueEvents: QueueEvents;

/**
 * Initialize BullMQ message queue
 */
export function initQueue(): void {
  const redisConfig = getRedisConfig();

  // Create Queue
  messageQueue = new Queue(MESSAGE_QUEUE_NAME, {
    connection: redisConfig,
    defaultJobOptions: {
      attempts: 5, // Retry up to 5 times
      backoff: {
        type: 'exponential',
        delay: 5000, // Wait 5s, 10s, 20s, etc.
      },
      removeOnComplete: {
        age: 24 * 3600, // Keep completed jobs for 24 hours
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // Keep failed jobs for 7 days (Dead Letter Queue)
      },
    },
  });

  // Listen to queue events for logging
  queueEvents = new QueueEvents(MESSAGE_QUEUE_NAME, { connection: redisConfig });

  queueEvents.on('completed', ({ jobId }) => {
    logger.info(`✅ Job ${jobId} completed successfully`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`❌ Job ${jobId} failed: ${failedReason}`);
  });

  queueEvents.on('error', (err) => {
    logger.error(`❌ Queue Error: ${err.message}`);
  });

  logger.info(`📦 Message Queue [${MESSAGE_QUEUE_NAME}] initialized`);
}

/**
 * Get the message queue instance
 */
export function getMessageQueue(): Queue {
  if (!messageQueue) {
    throw new Error('Message Queue not initialized. Call initQueue() first.');
  }
  return messageQueue;
}

/**
 * Add a message to the queue
 */
export async function queueMessage(data: {
  messageId: string;
  campaignId?: string;
  sessionId?: string;
  targetPhone: string;
  messageContent: string;
}): Promise<void> {
  const queue = getMessageQueue();
  await queue.add('send-message', data, {
    jobId: data.messageId, // Ensures idempotency (no duplicate jobs with same ID)
  });
}

/**
 * Gracefully close the queue
 */
export async function closeQueue(): Promise<void> {
  if (messageQueue) await messageQueue.close();
  if (queueEvents) await queueEvents.close();
  logger.info('📦 Message Queue closed');
}
