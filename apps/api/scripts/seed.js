/**
 * Prepares a fresh platform: removes the demo data (if it was ever added) and creates one
 * organization with one super admin (and, if asked, a support and an installer account).
 * Nothing else: homes, boards and people are added in the app.
 *
 *   pnpm --filter @home/api seed -- --email you@company.com --name "Your Name" --org "Your Company" --password "a-strong-password"
 *
 * Every option is optional (or set SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ORG_NAME, SEED_ADMIN_PASSWORD in .env).
 * Without a password a random one is made and printed once. Running it again keeps an existing
 * super admin with that email (it only removes demo data).
 *
 *   --support-email / --support-name / --support-password        also a support account (read-only staff)
 *   --installer-email / --installer-name / --installer-password  also an installer account
 *                (or SEED_SUPPORT_* / SEED_INSTALLER_* in the environment). A password left out is
 *                asked for when you run it in a terminal, else made at random and printed once.
 *
 *   --wipe-all   ERASES EVERYTHING first: a backup of the database is saved (pg_dump, in the backups
 *                folder), then every table is emptied, uploaded firmware and installation photos are
 *                deleted, and the boards' retained settings on the MQTT broker are cleared (so boards
 *                come back as fresh stock). Asks you to type WIPE to confirm, or pass --yes.
 *
 * On the server:
 *   docker exec -it home-api node scripts/seed.js --wipe-all --email you@x.com --name "You" --org "Company" \
 *     --support-email support@x.com --installer-email installer@x.com
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline/promises');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const prisma = new PrismaClient();
const DEMO_DOMAIN = '@demo.switchboard';

function arg(name, env, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] || fallback;
}

/** Deletes the "Switchboard Demo" organization and everything in it. */
async function removeDemo() {
  const orgs = await prisma.organization.findMany({
    where: { OR: [{ name: 'Switchboard Demo' }, { staff: { some: { email: { endsWith: DEMO_DOMAIN } } } }] },
    select: { id: true, name: true },
  });
  for (const org of orgs) {
    const homes = (await prisma.home.findMany({ where: { orgId: org.id }, select: { id: true } })).map((h) => h.id);
    // boards are kept by a home or an organization with "set null": remove them (and their devices) explicitly
    await prisma.node.deleteMany({ where: { OR: [{ orgId: org.id }, { homeId: { in: homes } }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ orgId: org.id }, { homeId: { in: homes } }] } });
    await prisma.notification.deleteMany({ where: { homeId: { in: homes } } });
    await prisma.organization.delete({ where: { id: org.id } }); // homes, rooms, memberships, invites, scenes, schedules follow
    console.log(`Removed demo organization "${org.name}" (${homes.length} homes).`);
  }
  const { count } = await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
  if (count) console.log(`Removed ${count} demo accounts.`);
  if (!orgs.length && !count) console.log('No demo data found.');
}

const flag = (name) => process.argv.includes(`--${name}`);

const dataDir = () => path.resolve(process.env.FIRMWARE_DIR || path.resolve(__dirname, '../../../data/firmware'), '..');
const firmwareDir = () => path.resolve(process.env.FIRMWARE_DIR || path.join(dataDir(), 'firmware'));
const filesDir = () => path.resolve(process.env.FILES_DIR || path.join(dataDir(), 'files'));
const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(dataDir(), 'backups'));

/** A full copy of the database before anything is erased (restore: pg_restore --clean -d "$DATABASE_URL" <file>). */
function backupFirst() {
  fs.mkdirSync(backupDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(backupDir(), `before-wipe-${stamp}.dump`);
  const url = (process.env.DATABASE_URL || '').replace(/[?&]schema=[^&]*/, '');
  try {
    execFileSync('pg_dump', ['--format=custom', `--file=${file}`, url], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new Error(`Could not back up the database first, so nothing was erased (${String(e.stderr || e.message).trim()}). Add --no-backup to erase anyway.`);
  }
  console.log(`Backup saved: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

/** Forgets every board's retained settings, states and status on the broker. */
async function clearBroker() {
  const url = process.env.MQTT_URL;
  if (!url) return console.log('MQTT_URL is not set: the broker was not cleared.');
  let mqtt;
  try { mqtt = require('mqtt'); } catch { return console.log('No MQTT library here: the broker was not cleared.'); }
  const client = await mqtt.connectAsync(url, {
    username: process.env.MQTT_API_USERNAME || 'api', password: process.env.MQTT_API_PASSWORD, connectTimeout: 8000, reconnectPeriod: 0,
  });
  const retained = new Set();
  client.on('message', (topic, payload, packet) => { if (packet.retain && payload.length) retained.add(topic); });
  await client.subscribeAsync('home/v1/#');
  await new Promise((r) => setTimeout(r, 2500)); // the broker sends every retained message on subscribe
  await client.unsubscribeAsync('home/v1/#');
  for (const topic of retained) await client.publishAsync(topic, '', { retain: true, qos: 1 });
  await client.endAsync();
  console.log(`Cleared ${retained.size} retained messages on the broker.`);
}

function emptyDir(dir, keep = () => false) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir)) {
    if (keep(f)) continue;
    fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    n++;
  }
  return n;
}

/** Backs up, then empties every table (the migration history stays), uploaded files and the broker. */
async function wipeAll() {
  if (!flag('yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('This deletes EVERYTHING (organizations, homes, boards, people, bills, logs, firmware, photos). Type WIPE to continue: ');
    rl.close();
    if (answer.trim() !== 'WIPE') throw new Error('Nothing was changed.');
  }
  if (!flag('no-backup')) backupFirst();
  const tables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  const firmware = emptyDir(firmwareDir(), (f) => !f.endsWith('.bin'));
  const files = emptyDir(filesDir());
  console.log(`Wiped ${tables.length} tables, ${firmware} firmware files and ${files} folders of uploads (photos).`);
  try { await clearBroker(); } catch (e) { console.log(`The broker was not cleared (${e.message}).`); }
}

const COMMON = ['password', 'password1', '12345678', '123456789', '1234567890', '11111111', '00000000', 'qwertyui',
  'qwerty123', 'iloveyou', 'abc12345', 'switchboard', 'pakistan', 'pakistan1', 'pakistan123', 'welcome1'];
function checkPassword(p, who) {
  if (p.length < 8) throw new Error(`${who}: use at least 8 characters.`);
  if (!/[\d\W_]/.test(p)) throw new Error(`${who}: add a number or a symbol.`);
  if (COMMON.includes(p.toLowerCase())) throw new Error(`${who}: that password is too common.`);
}

/** The password given, else asked for in a terminal, else a random one (printed once). */
async function passwordFor(who, given) {
  if (given) { checkPassword(given, who); return { password: given, made: false }; }
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`Password for ${who} (Enter for a random one): `)).trim();
    rl.close();
    if (typed) { checkPassword(typed, who); return { password: typed, made: false }; }
  }
  return { password: `${randomBytes(9).toString('base64url')}7`, made: true };
}

async function main() {
  if (flag('wipe-all')) await wipeAll();
  else await removeDemo();

  const email = arg('email', 'SEED_ADMIN_EMAIL', 'admin@switchboard.local').trim().toLowerCase();
  const name = arg('name', 'SEED_ADMIN_NAME', 'Super admin').trim();
  const orgName = arg('org', 'SEED_ORG_NAME', 'My company').trim();
  const given = arg('password', 'SEED_ADMIN_PASSWORD', '');
  if (given) checkPassword(given, 'Super admin');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.staffRole === 'SUPERADMIN') {
    console.log(`Super admin ${email} already exists — nothing else to do.`);
    return;
  }
  if (existing) throw new Error(`${email} already has an account that is not a super admin. Use another --email.`);

  const staff = [
    ['SUPPORT', 'support', 'Support'], ['INSTALLER', 'installer', 'Installer'],
  ].map(([role, key, label]) => ({
    role, label,
    email: arg(`${key}-email`, `SEED_${role}_EMAIL`, '').trim().toLowerCase(),
    name: arg(`${key}-name`, `SEED_${role}_NAME`, label).trim(),
    given: arg(`${key}-password`, `SEED_${role}_PASSWORD`, ''),
  })).filter((s) => s.email);
  for (const s of staff) {
    if (s.email === email || (await prisma.user.findUnique({ where: { email: s.email } }))) throw new Error(`${s.email} already has an account.`);
  }

  const { password, made } = await passwordFor('the super admin', given);
  const staffPasswords = [];
  for (const s of staff) staffPasswords.push(await passwordFor(`${s.label.toLowerCase()} ${s.email}`, s.given));
  // A single organization made here behaves like a self-hosted install: boards that connect go into its stock.
  const onlyOne = (await prisma.organization.count()) === 0;
  const org = await prisma.organization.create({
    data: { name: orgName, status: 'ACTIVE', billingEmail: email, billingName: orgName, selfHosted: onlyOne },
  });
  await prisma.user.create({
    data: { email, name, passwordHash: await hash(password), orgId: org.id, staffRole: 'SUPERADMIN' },
  });
  for (const [i, s] of staff.entries()) {
    await prisma.user.create({
      data: { email: s.email, name: s.name, passwordHash: await hash(staffPasswords[i].password), orgId: org.id, staffRole: s.role },
    });
  }
  console.log(`\nCreated organization "${orgName}":`);
  const show = (label, mail, p) => console.log(`  ${label.padEnd(12)} ${mail.padEnd(32)} ${p.made ? p.password : '(the password you gave)'}`);
  show('Super admin', email, { password, made });
  for (const [i, s] of staff.entries()) show(s.label, s.email, staffPasswords[i]);
  if (made || staffPasswords.some((p) => p.made)) console.log('  Write the random passwords down: they are not shown again.');
  console.log(`\nSign in at ${process.env.PUBLIC_URL || 'http://localhost:3000'}${staff.length ? '' : ' and create your first home in the console'}.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
