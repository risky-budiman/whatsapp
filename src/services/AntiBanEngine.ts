import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getDb } from '../config/database';

export class AntiBanEngine {
  private batchCounter: number = 0;
  private lastRestTime: number = Date.now();

  /**
   * Get a random delay between MIN and MAX (in ms)
   */
  getRandomDelayMs(minSec: number = env.DELAY_MIN, maxSec: number = env.DELAY_MAX): number {
    const minMs = minSec * 1000;
    const maxMs = maxSec * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
  }

  /**
   * Check if the engine needs to rest based on batch size.
   * If yes, wait for the rest period.
   */
  async checkAndApplyRest(
    batchSize: number = env.BATCH_SIZE,
    restMinSec: number = env.REST_MIN,
    restMaxSec: number = env.REST_MAX
  ): Promise<void> {
    this.batchCounter++;

    if (this.batchCounter >= batchSize) {
      const restDelayMs = this.getRandomDelayMs(restMinSec, restMaxSec);
      
      logger.info(
        `😴 AntiBan: Batch size ${batchSize} reached. Resting for ${Math.round(
          restDelayMs / 60000
        )} minutes...`
      );

      await this.delay(restDelayMs);

      // Reset counter after rest
      this.batchCounter = 0;
      this.lastRestTime = Date.now();
      
      logger.info('☀️ AntiBan: Rest finished. Resuming operations.');
    }
  }

  /**
   * Wait for a specified random delay (Jitter)
   */
  async applyJitter(minSec?: number, maxSec?: number): Promise<void> {
    const delayMs = this.getRandomDelayMs(minSec, maxSec);
    logger.info(`⏳ AntiBan: Waiting ${Math.round(delayMs / 1000)}s before next action...`);
    await this.delay(delayMs);
  }

  /**
   * Helper to sleep
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton
const antiBanEngine = new AntiBanEngine();
export function getAntiBanEngine() {
  return antiBanEngine;
}
