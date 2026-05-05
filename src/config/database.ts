import mysql from 'mysql2/promise';
import { env } from './env';
import { logger } from '../utils/logger';

let pool: mysql.Pool;
let laravelPool: mysql.Pool;

/**
 * Get the main WA Gateway database connection pool
 */
export function getDb(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
    logger.info('✅ MySQL pool created (whatsapp_gateway)');
  }
  return pool;
}

/**
 * Get the Laravel database connection pool (for contact sync)
 */
export function getLaravelDb(): mysql.Pool {
  if (!laravelPool) {
    laravelPool = mysql.createPool({
      host: env.LARAVEL_DB_HOST,
      port: env.LARAVEL_DB_PORT,
      user: env.LARAVEL_DB_USER,
      password: env.LARAVEL_DB_PASSWORD,
      database: env.LARAVEL_DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
    logger.info('✅ MySQL pool created (laravel_radius)');
  }
  return laravelPool;
}

/**
 * Test database connection
 */
export async function testDbConnection(): Promise<boolean> {
  try {
    const db = getDb();
    const [rows] = await db.query('SELECT 1 as ok');
    logger.info('✅ MySQL connection test passed (whatsapp_gateway)');
    return true;
  } catch (error: any) {
    logger.error(`❌ MySQL connection failed: ${error.message}`);
    return false;
  }
}

/**
 * Gracefully close all pools
 */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  if (laravelPool) await laravelPool.end();
  logger.info('MySQL pools closed');
}
