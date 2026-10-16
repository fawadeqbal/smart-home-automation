import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { AuthUser } from '../auth/auth.types';
import { zoneOffsetMinutes } from '../automation/time';
import { AuditService } from '../common/audit.service';
import { SETTINGS, Settings } from '../config';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';

const run = promisify(execFile);
const NAME = /^switchboard-(\d{8}-\d{4})(-manual)?\.tar\.gz$/;
const KEEP_DAYS = 14;
const KEEP_MANUAL = 5;

/** "switchboard-20261017-0300.tar.gz" for a time (UTC, so names sort and never clash across zones). */
export function backupName(at: Date, manual: boolean) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `switchboard-${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${manual ? '-manual' : ''}.tar.gz`;
}

/** Which backups to delete: daily ones older than two weeks (the newest three always stay), manual ones beyond five. */
export function toPrune(names: string[], now = new Date()) {
  const parsed = names.map((n) => ({ n, m: NAME.exec(n) })).filter((x) => x.m).sort((a, b) => b.n.localeCompare(a.n));
  const daily = parsed.filter((x) => !x.m![2]);
  const manual = parsed.filter((x) => x.m![2]);
  const old = (stamp: string) => {
    const t = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8));
    return now.getTime() - t > KEEP_DAYS * 86_400_000;
  };
  return [...daily.slice(3).filter((x) => old(x.m![1]!)), ...manual.slice(KEEP_MANUAL)].map((x) => x.n);
}

/**
 * Backups on the server: every night at 3 am (Pakistan time) the whole database (pg_dump), the
 * firmware builds and the uploaded photos go into one .tar.gz in the data volume. Kept two weeks;
 * a super admin of a self-hosted company can make one now and download any of them.
 */
@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Backups');
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastError: { at: Date; message: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly monitoring: MonitoringService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.nightly(), 30 * 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  get dir() {
    return this.settings.backupDir;
  }

  /** A backup holds every company's data: only a super admin of a self-hosted install may see or download them. */
  private async allowed(staff: AuthUser) {
    if (staff.staffRole !== StaffRole.SUPERADMIN || !staff.orgId) throw new ForbiddenException('Backups are for super admins.');
    const org = await this.prisma.organization.findUnique({ where: { id: staff.orgId }, select: { selfHosted: true } });
    if (!org?.selfHosted) throw new ForbiddenException('Backups are kept by the server’s owner on a shared server.');
  }

  async list(staff: AuthUser) {
    await this.allowed(staff);
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((n) => NAME.test(n)).sort().reverse();
    const rows = await Promise.all(files.map(async (n) => {
      const s = await stat(join(this.dir, n));
      return { name: n, size: s.size, createdAt: s.mtime, manual: n.includes('-manual') };
    }));
    return { backups: rows, running: this.running, lastError: this.lastError, keepDays: KEEP_DAYS };
  }

  async now(staff: AuthUser) {
    await this.allowed(staff);
    if (this.running) throw new BadRequestException('A backup is being made right now.');
    const made = await this.make(true);
    await this.audit.record(null, staff.id, 'backup.create', made.name, { size: made.size }, staff.orgId);
    return this.list(staff);
  }

  async file(staff: AuthUser, name: string) {
    await this.allowed(staff);
    if (!NAME.test(name)) throw new NotFoundException('No such backup.');
    const path = resolve(join(this.dir, name));
    await stat(path).catch(() => { throw new NotFoundException('No such backup.'); });
    await this.audit.record(null, staff.id, 'backup.download', name, {}, staff.orgId);
    return path;
  }

  async remove(staff: AuthUser, name: string) {
    await this.allowed(staff);
    if (!NAME.test(name)) throw new NotFoundException('No such backup.');
    await rm(join(this.dir, name), { force: true });
    await this.audit.record(null, staff.id, 'backup.remove', name, {}, staff.orgId);
    return this.list(staff);
  }

  // ---------------------------------------------------------------- making one
  /** Once a night, at 3 am in Pakistan (when nobody is using the app much). */
  async nightly(now = new Date()) {
    const local = new Date(now.getTime() + zoneOffsetMinutes('Asia/Karachi', now) * 60_000);
    if (local.getUTCHours() !== 3 || this.running) return;
    const today = backupName(now, false).slice(0, 'switchboard-YYYYMMDD'.length);
    await mkdir(this.dir, { recursive: true });
    if ((await readdir(this.dir)).some((n) => n.startsWith(today) && !n.includes('-manual'))) return;
    try {
      await this.make(false, now);
    } catch {
      // told already
    }
  }

  async make(manual: boolean, at = new Date()) {
    this.running = true;
    const work = await mkdtemp(join(tmpdir(), 'sb-backup-'));
    try {
      await mkdir(this.dir, { recursive: true });
      const stage = join(work, 'switchboard');
      await mkdir(stage);
      // the database, in pg_dump's own format (pg_restore puts it back)
      const url = new URL(process.env.DATABASE_URL ?? '');
      const env = {
        ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.replace(/^\//, ''),
      };
      await run('pg_dump', ['--format=custom', '--no-owner', '--file', join(stage, 'database.dump')], { env, timeout: 10 * 60_000 }).catch((e: NodeJS.ErrnoException & { stderr?: string }) => {
        throw new Error(e.code === 'ENOENT' ? 'pg_dump isn’t installed on this server.' : (e.stderr || e.message).trim().split('\n').pop()!);
      });
      // firmware builds and uploaded photos
      for (const [dir, as] of [[this.settings.firmwareDir, 'firmware'], [this.settings.filesDir, 'files']] as const) {
        await cp(dir, join(stage, as), { recursive: true }).catch(() => undefined);
      }
      const counts = {
        homes: await this.prisma.home.count(), boards: await this.prisma.node.count(), people: await this.prisma.user.count(), devices: await this.prisma.device.count(),
      };
      await writeFile(join(stage, 'backup.json'), JSON.stringify({ made: at.toISOString(), manual, counts, restore: 'See "Backups and restoring" in the Help Center.' }, null, 2));
      const name = backupName(at, manual);
      await run('tar', ['-czf', join(this.dir, name), '-C', work, 'switchboard'], { timeout: 10 * 60_000 });
      const size = (await stat(join(this.dir, name))).size;
      this.lastError = null;
      this.log.log(`Backup ${name} (${Math.round(size / 1024)} KB)`);
      for (const old of toPrune(await readdir(this.dir), at)) await rm(join(this.dir, old), { force: true });
      return { name, size };
    } catch (err) {
      const message = (err as Error).message;
      this.lastError = { at, message };
      this.log.error(`Backup failed: ${message}`);
      await this.tellSuperAdmins(`The ${manual ? '' : 'nightly '}backup failed`, message);
      throw new BadRequestException(`The backup failed: ${message}`);
    } finally {
      this.running = false;
      await rm(work, { recursive: true, force: true });
    }
  }

  private async tellSuperAdmins(title: string, body: string) {
    const admins = await this.prisma.user.findMany({ where: { staffRole: StaffRole.SUPERADMIN, disabled: false, org: { selfHosted: true } }, select: { id: true, orgId: true } });
    for (const a of admins) {
      const home = await this.prisma.home.findFirst({ where: { orgId: a.orgId! }, select: { id: true } });
      if (home) await this.monitoring.notify(home.id, [a.id], { kind: 'backup', severity: 'WARN', title, body, link: '/console/backups' });
    }
  }
}
