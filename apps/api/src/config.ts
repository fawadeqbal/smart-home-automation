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
  /** Shown to owners in the add-board wizard (what to type on the board's setup page). */
  mqttNodePassword: string;
  mqttPublicPort: number;
  /** How boards reach this API for firmware downloads, e.g. http://192.168.1.119:4000 (default: this PC's LAN address). */
  publicApiUrl: string | null;
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
    publicApiUrl: process.env.PUBLIC_API_URL?.replace(/\/+$/, '') || null,
    // Off by default: all boards share one broker login, so open sign-up would let any tenant's staff
    // read that password. Turn on once boards have their own credentials (see README → Selling it).
    allowSignup: process.env.ALLOW_SIGNUP === 'true',
  };
}

export const SETTINGS = Symbol('SETTINGS');
