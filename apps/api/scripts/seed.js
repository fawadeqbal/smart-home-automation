/**
 * Prepares a fresh platform: removes the demo data (if it was ever added) and creates one
 * organization with one super admin. Nothing else — homes, boards and people are added in the app.
 *
 *   pnpm --filter @home/api seed -- --email you@company.com --name "Your Name" --org "Your Company" --password "a-strong-password"
 *
 * Every option is optional (or set SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ORG_NAME, SEED_ADMIN_PASSWORD in .env).
 * Without a password a random one is made and printed once. Running it again keeps an existing
 * super admin with that email (it only removes demo data).
 *
 *   --wipe-all   ERASES THE WHOLE DATABASE first (every organization, home, board, person, log,
 *                firmware upload) and starts over with just this super admin. Asks you to type
 *                WIPE to confirm, or pass --yes to skip the question.
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { randomBytes } = require('node:crypto');
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

/** Empties every table (the migration history stays) and deletes uploaded firmware files. */
async function wipeAll() {
  if (!flag('yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('This deletes EVERYTHING in the database (organizations, homes, boards, people, logs). Type WIPE to continue: ');
    rl.close();
    if (answer.trim() !== 'WIPE') throw new Error('Nothing was changed.');
  }
  const tables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  const dir = path.resolve(process.env.FIRMWARE_DIR || path.resolve(__dirname, '../../../data/firmware'));
  let files = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.bin')) { fs.unlinkSync(path.join(dir, f)); files++; }
  }
  console.log(`Wiped ${tables.length} tables${files ? ` and ${files} firmware files` : ''}.`);
}

async function main() {
  if (flag('wipe-all')) await wipeAll();
  else await removeDemo();

  const email = arg('email', 'SEED_ADMIN_EMAIL', 'admin@switchboard.local').trim().toLowerCase();
  const name = arg('name', 'SEED_ADMIN_NAME', 'Super admin').trim();
  const orgName = arg('org', 'SEED_ORG_NAME', 'My company').trim();
  const given = arg('password', 'SEED_ADMIN_PASSWORD', '');
  if (given && given.length < 8) throw new Error('The password must be at least 8 characters.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.staffRole === 'SUPERADMIN') {
    console.log(`Super admin ${email} already exists — nothing else to do.`);
    return;
  }
  if (existing) throw new Error(`${email} already has an account that is not a super admin. Use another --email.`);

  const password = given || randomBytes(9).toString('base64url');
  // A single organization made here behaves like a self-hosted install: boards that connect go into its stock.
  const onlyOne = (await prisma.organization.count()) === 0;
  const org = await prisma.organization.create({
    data: { name: orgName, status: 'ACTIVE', billingEmail: email, billingName: orgName, selfHosted: onlyOne },
  });
  await prisma.user.create({
    data: { email, name, passwordHash: await hash(password), orgId: org.id, staffRole: 'SUPERADMIN' },
  });
  console.log(`\nCreated organization "${orgName}" and its super admin.`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${given ? '(the one you gave)' : password}`);
  if (!given) console.log('  Write it down — it is not shown again.');
  console.log('\nSign in at http://localhost:3000 and create your first home in the console.');
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
