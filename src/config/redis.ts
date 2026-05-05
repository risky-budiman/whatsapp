import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redisClient: Redis;

/**
 * Get Redis connection instance (singleton)
 */
export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('❌ Redis: Max retry attempts reached');
          return null;
        }
        return Math.min(times * 200, 5000);
      },
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis connected');
    });

    redisClient.on('error', (err) => {
      logger.error(`❌ Redis error: ${err.message}`);
    });
  }
  return redisClient;
}

/**
 * Get Redis connection config for BullMQ
 */
export function getRedisConfig() {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  };
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.ping();
    logger.info('✅ Redis connection test passed');
    return true;
  } catch (error: any) {
    logger.error(`❌ Redis connection failed: ${error.message}`);
    return false;
  }
}

/**
 * Gracefully close Redis
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis connection closed');
  }
}
