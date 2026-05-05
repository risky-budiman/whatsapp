import dotenv from 'dotenv';
dotenv.config();

export const env = {
  // Application
  APP_PORT: parseInt(process.env.APP_PORT || '3100', 10),
  APP_ENV: process.env.APP_ENV || 'development',
  API_KEY: process.env.API_KEY || 'change-me',

  // MySQL Database
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'whatsapp_gateway',

  // Laravel Database (contact sync)
  LARAVEL_DB_HOST: process.env.LARAVEL_DB_HOST || '127.0.0.1',
  LARAVEL_DB_PORT: parseInt(process.env.LARAVEL_DB_PORT || '3306', 10),
  LARAVEL_DB_USER: process.env.LARAVEL_DB_USER || 'root',
  LARAVEL_DB_PASSWORD: process.env.LARAVEL_DB_PASSWORD || '',
  LARAVEL_DB_NAME: process.env.LARAVEL_DB_NAME || 'laravel_radius',

  // Redis
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,

  // Anti-Ban Settings
  DELAY_MIN: parseInt(process.env.DELAY_MIN || '20', 10),
  DELAY_MAX: parseInt(process.env.DELAY_MAX || '90', 10),
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '40', 10),
  REST_MIN: parseInt(process.env.REST_MIN || '600', 10),
  REST_MAX: parseInt(process.env.REST_MAX || '1200', 10),
  DAILY_LIMIT: parseInt(process.env.DAILY_LIMIT || '200', 10),

  // Webhook
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
};

/**
 * Validate critical env vars on startup
 */
export function validateEnv(): void {
  const required = ['DB_HOST', 'DB_NAME', 'REDIS_HOST'];
  const missing = required.filter((key) => !process.env[key] && !(env as any)[key]);
  if (missing.length > 0) {
    console.warn(`⚠️  Missing env vars (using defaults): ${missing.join(', ')}`);
  }
  if (env.API_KEY === 'change-me' || env.API_KEY === 'your-secret-api-key-change-this') {
    console.warn('⚠️  WARNING: Using default API_KEY. Please set a secure key in .env');
  }
}
