/**
 * Typed settings, read once from the environment. Nothing else reads process.env.
 * Locally the repository's root .env is loaded; in Docker, Compose passes the variables.
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

loadDotenv({ path: resolve(__dirname, '../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

export interface Settings {
  port: number;
  databaseUrl: string;
  mqttUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  jwtSecret: string;
  webOrigins: string[];
  cookieSecure: boolean;
  assistantUrl: string;
  assistantSecret: string;
  commandTimeoutMs: number;
  /** Anyone may create an organization at /signup (a public SaaS). false: invite-only after the first run. */
  allowSignup: boolean;
  /** Where uploaded firmware images are kept. */
  firmwareDir: string;
  /** uploaded files (installation photos) */
  filesDir: string;
  /** nightly backups (database + firmware + files) */
  backupDir: string;
  /** Shown to owners in the add-board wizard (what to type on the board's setup page). */
  mqttNodePassword: string;
  mqttPublicPort: number;
  /** How boards reach this API for firmware downloads, e.g. http://192.168.1.119:4000 (default: this PC's LAN address). */
  publicApiUrl: string | null;
  /** The broker's log file (read-only): board connections, their public IPs and why they ended. null: not tracked. */
  brokerLog: string | null;
  /** Where the free DB-IP lite databases (IP -> city, provider) are kept; null: no lookups (GEOIP=off). */
  geoDir: string | null;
  /** The site people open: links in emails start with it (default: the first WEB_ORIGIN). */
  publicUrl: string;
  /** Outgoing email (Gmail: smtp.gmail.com, 465, the address, an app password). null: email is off. */
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  /** How often the scheduler looks for timers that are due (ms). */
  schedulerTickMs: number;
  /** A timer whose board was offline or didn't answer is tried again after these many minutes (then it has failed). */
  scheduleRetryMinutes: number[];
  /** After the server was down: a schedule more than this late is skipped (or run late, if it says so). */
  missedCutoffMinutes: number;
}

export function loadSettings(): Settings {
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 16) throw new Error('JWT_SECRET must be at least 16 characters.');
  return {
    port: Number(process.env.API_PORT || 4000),
    databaseUrl: required('DATABASE_URL'),
    mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    mqttUsername: process.env.MQTT_API_USERNAME ?? 'api',
    mqttPassword: required('MQTT_API_PASSWORD'),
    jwtSecret,
    webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',
    assistantUrl: process.env.ASSISTANT_URL ?? 'http://localhost:8000',
    assistantSecret: process.env.ASSISTANT_SHARED_SECRET ?? '',
    commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS || 3000),
    mqttNodePassword: process.env.MQTT_NODE_PASSWORD ?? '',
    mqttPublicPort: Number(process.env.MQTT_PUBLIC_PORT || 1883),
    firmwareDir: resolve(process.env.FIRMWARE_DIR || resolve(__dirname, '../../../data/firmware')),
    backupDir: resolve(process.env.BACKUP_DIR || resolve(process.env.FIRMWARE_DIR || resolve(__dirname, '../../../data/firmware'), '../backups')),
    filesDir: resolve(process.env.FILES_DIR || resolve(process.env.FIRMWARE_DIR || resolve(__dirname, '../../../data/firmware'), '../files')),
    publicApiUrl: process.env.PUBLIC_API_URL?.replace(/\/+$/, '') || null,
    brokerLog: process.env.BROKER_LOG || null,
    geoDir: process.env.GEOIP === 'off' ? null : resolve(process.env.GEOIP_DIR || resolve(process.env.FIRMWARE_DIR || resolve(__dirname, '../../../data/firmware'), '../geo')),
    // Off by default: all boards share one broker login, so open sign-up would let any tenant's staff
    // read that password. Turn on once boards have their own credentials (see README → Selling it).
    allowSignup: process.env.ALLOW_SIGNUP === 'true',
    publicUrl: (process.env.PUBLIC_URL || (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]!).trim().replace(/\/+$/, ''),
    smtp: process.env.SMTP_USER && process.env.SMTP_PASS ? {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      user: process.env.SMTP_USER,
      // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"): the spaces aren't part of it
      pass: process.env.SMTP_PASS.replace(/\s+/g, ''),
      from: process.env.MAIL_FROM || `Switchboard <${process.env.SMTP_USER}>`,
    } : null,
    schedulerTickMs: Number(process.env.SCHEDULER_TICK_MS || 5000),
    scheduleRetryMinutes: (process.env.SCHEDULE_RETRY_MINUTES || '1,3,10').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0),
    missedCutoffMinutes: Number(process.env.SCHEDULE_MISSED_CUTOFF_MIN || 15),
  };
}

export const SETTINGS = Symbol('SETTINGS');
