/**
 * Database Migration Script
 * Run: npm run migrate
 * Creates all required tables in MySQL
 */
import { env, validateEnv } from '../config/env';
import { getDb, closeDb } from '../config/database';
import { logger } from '../utils/logger';

const TABLES = [
  {
    name: 'wa_sessions',
    sql: `CREATE TABLE IF NOT EXISTS wa_sessions (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone_number VARCHAR(100),
      status ENUM('connecting','active','disconnected','banned') DEFAULT 'connecting',
      daily_sent_count INT DEFAULT 0,
      daily_limit INT DEFAULT 200,
      last_sent_at TIMESTAMP NULL,
      last_connected_at TIMESTAMP NULL,
      priority INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_session_auth',
    sql: `CREATE TABLE IF NOT EXISTS wa_session_auth (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36) NOT NULL UNIQUE,
      auth_data LONGTEXT NOT NULL COMMENT 'JSON auth state dari Baileys',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES wa_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_contacts',
    sql: `CREATE TABLE IF NOT EXISTS wa_contacts (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36),
      phone_number VARCHAR(100) NOT NULL,
      name VARCHAR(255),
      tags JSON,
      is_opted_out BOOLEAN DEFAULT FALSE,
      opted_out_at TIMESTAMP NULL,
      source VARCHAR(50) DEFAULT 'manual' COMMENT 'manual|import|laravel_sync|device_sync',
      laravel_customer_id INT COMMENT 'FK ke customers.id di Laravel',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_phone (phone_number),
      INDEX idx_session (session_id),
      UNIQUE INDEX idx_session_phone (session_id, phone_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_campaigns',
    sql: `CREATE TABLE IF NOT EXISTS wa_campaigns (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      template_message TEXT NOT NULL,
      variation_pool JSON COMMENT 'Variasi kata untuk anti-spam',
      status ENUM('draft','scheduled','running','paused','completed','failed') DEFAULT 'draft',
      scheduled_at TIMESTAMP NULL,
      started_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      total_recipients INT DEFAULT 0,
      sent_count INT DEFAULT 0,
      failed_count INT DEFAULT 0,
      delay_min INT DEFAULT 20 COMMENT 'Delay minimum (detik)',
      delay_max INT DEFAULT 90 COMMENT 'Delay maksimum (detik)',
      batch_size INT DEFAULT 40,
      rest_min INT DEFAULT 600 COMMENT 'Istirahat minimum (detik)',
      rest_max INT DEFAULT 1200 COMMENT 'Istirahat maksimum (detik)',
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_campaign_messages',
    sql: `CREATE TABLE IF NOT EXISTS wa_campaign_messages (
      id VARCHAR(36) PRIMARY KEY,
      campaign_id VARCHAR(36) NOT NULL,
      session_id VARCHAR(36),
      target_phone VARCHAR(20) NOT NULL,
      target_name VARCHAR(255),
      message_content TEXT,
      status ENUM('pending','queued','sending','sent','failed') DEFAULT 'pending',
      error_message TEXT,
      retry_count INT DEFAULT 0,
      max_retries INT DEFAULT 3,
      sent_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES wa_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES wa_sessions(id) ON DELETE SET NULL,
      INDEX idx_status (status),
      INDEX idx_campaign (campaign_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_message_logs',
    sql: `CREATE TABLE IF NOT EXISTS wa_message_logs (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36),
      campaign_id VARCHAR(36),
      target_phone VARCHAR(20) NOT NULL,
      message_content TEXT,
      direction ENUM('outgoing','incoming') DEFAULT 'outgoing',
      status ENUM('sent','failed','received') DEFAULT 'sent',
      error TEXT,
      metadata JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_session (session_id),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_chats',
    sql: `CREATE TABLE IF NOT EXISTS wa_chats (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36),
      phone_number VARCHAR(100) NOT NULL,
      message_id VARCHAR(100),
      message_text TEXT NOT NULL,
      is_from_me BOOLEAN DEFAULT FALSE,
      status ENUM('sent', 'delivered', 'read', 'failed', 'received') DEFAULT 'received',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_phone (phone_number),
      INDEX idx_created (created_at),
      INDEX idx_msg_id (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'wa_jid_mappings',
    sql: `CREATE TABLE IF NOT EXISTS wa_jid_mappings (
      jid VARCHAR(100) PRIMARY KEY,
      phone_number VARCHAR(100) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_phone (phone_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
];

async function migrate() {
  console.log('🔄 Starting database migration...\n');
  validateEnv();

  const db = getDb();

  // Ensure database exists
  try {
    const conn = await (await import('mysql2/promise')).createConnection({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.end();
    console.log(`✅ Database "${env.DB_NAME}" ensured\n`);
  } catch (err: any) {
    console.error(`❌ Could not create database: ${err.message}`);
    process.exit(1);
  }

  // Create tables
  for (const table of TABLES) {
    try {
      await db.query(table.sql);
      console.log(`  ✅ Table "${table.name}" created/verified`);
    } catch (err: any) {
      console.error(`  ❌ Table "${table.name}" failed: ${err.message}`);
    }
  }

  // Phase 9 schema fixes (for full JID support)
  const fixes = [
    { name: 'Contacts Phone Size', sql: 'ALTER TABLE wa_contacts MODIFY phone_number VARCHAR(100)' },
    { name: 'Chats Phone Size', sql: 'ALTER TABLE wa_chats MODIFY phone_number VARCHAR(100)' },
    { name: 'Message ID Column', sql: 'ALTER TABLE wa_chats ADD COLUMN message_id VARCHAR(100)' },
    { name: 'Logs Phone Size', sql: 'ALTER TABLE wa_message_logs MODIFY target_phone VARCHAR(100)' },
    { name: 'Campaign Phone Size', sql: 'ALTER TABLE wa_campaign_messages MODIFY target_phone VARCHAR(100)' },
    { name: 'Contacts Session ID', sql: 'ALTER TABLE wa_contacts ADD COLUMN session_id VARCHAR(36) AFTER id' },
    { name: 'Contacts Phone Size Fix', sql: 'ALTER TABLE wa_contacts MODIFY phone_number VARCHAR(100)' },
    { name: 'Contacts Remove Old Unique', sql: 'ALTER TABLE wa_contacts DROP INDEX phone_number' },
    { name: 'Contacts New Composite Unique', sql: 'ALTER TABLE wa_contacts ADD UNIQUE INDEX idx_session_phone (session_id, phone_number)' },
  ];

  for (const fix of fixes) {
    try {
      await db.query(fix.sql);
      console.log(`  ✅ ${fix.name} updated`);
    } catch (err: any) {
      // Ignore "duplicate column" errors
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log(`  ℹ️  ${fix.name} already exists`);
      } else {
        console.warn(`  ⚠️  ${fix.name} update skipped: ${err.message}`);
      }
    }
  }

    // 2. Add message_id to wa_chats if not exists
    try {
      await db.query("ALTER TABLE wa_chats ADD COLUMN message_id VARCHAR(255) AFTER phone_number");
      logger.info('  ✅ Column "message_id" added to wa_chats');
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') logger.info('  ℹ️  Message ID Column already exists in wa_chats');
      else throw e;
    }

    // 3. Update wa_sessions phone_number size
    try {
      await db.query("ALTER TABLE wa_sessions MODIFY COLUMN phone_number VARCHAR(100)");
      logger.info('  ✅ Column "phone_number" size updated in wa_sessions');
    } catch (e: any) {
      logger.error(`  ❌ Failed to update wa_sessions phone size: ${e.message}`);
    }

  console.log('\n🎉 Migration complete!');
  await closeDb();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
