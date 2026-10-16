import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CommandStatus, NodeStatus, Prisma, Role, StaffRole } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { SETTINGS, Settings } from '../config';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';

export interface Item { key: string; label: string; done: boolean; note?: string }

/** What every installation checks before the customer signs (the order the work is done in). */
export const CHECKLIST: { key: string; label: string; auto?: string }[] = [
  { key: 'mains', label: 'Mains switched off at the DB while wiring' },
  { key: 'enclosure', label: 'Every board in a closed, ventilated box, away from water' },
  { key: 'wiring', label: 'Right wire size, tight terminals, no bare copper' },
  { key: 'earth', label: 'Earth connected where the device needs it' },
  { key: 'wall', label: 'Every wall switch still works by hand' },
  { key: 'wifi', label: 'Every board online with a good Wi‑Fi signal', auto: 'wifi' },
  { key: 'devices', label: 'Every device switched from the app and confirmed', auto: 'devices' },
  { key: 'sensors', label: 'Every sensor shows a reading', auto: 'sensors' },
  { key: 'owner', label: 'Owner invited and signed in on their phone', auto: 'owner' },
  { key: 'handover', label: 'Owner shown the app, the assistant, away mode and Help requests' },
  { key: 'clean', label: 'Work area cleaned up, covers back on' },
];

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTOS = 40;

/**
 * Installation reports: the installer ticks the checklist (some items check themselves from what
 * the boards report), adds photos of the work, and the customer signs on the installer's phone or
 * their own. After signing it is a record: only a super admin can open it again.
 */
@Injectable()
export class InstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
    private readonly monitoring: MonitoringService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  // ---------------------------------------------------------------- who may do what
  /** Staff: the home must be theirs to see; `edit` needs its installer or a super admin. */
  private async staffHome(staff: AuthUser, homeId: string, edit: boolean) {
    const home = await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(staff), id: homeId }, select: { id: true, name: true, orgId: true, installerId: true } });
    if (!home) throw new NotFoundException('No such home.');
    if (edit && staff.staffRole !== StaffRole.SUPERADMIN && home.installerId !== staff.id) {
      throw new ForbiddenException('Only the home’s installer or a super admin can change its installation report.');
    }
    return home;
  }

  private async report(home: { id: string; orgId: string; installerId: string | null }) {
    const found = await this.prisma.installationReport.findUnique({ where: { homeId: home.id }, include: { photos: { orderBy: { createdAt: 'asc' } } } });
    if (found) return found;
    return this.prisma.installationReport.create({
      data: { homeId: home.id, orgId: home.orgId, installerId: home.installerId, items: CHECKLIST.map((c) => ({ key: c.key, label: c.label, done: false })) as unknown as Prisma.InputJsonValue },
      include: { photos: true },
    });
  }

  // ---------------------------------------------------------------- reading
  async forStaff(staff: AuthUser, homeId: string) {
    const home = await this.staffHome(staff, homeId, false);
    const canEdit = staff.staffRole === StaffRole.SUPERADMIN || home.installerId === staff.id;
    return { ...(await this.view(await this.report(home), home.name)), canEdit, canReopen: staff.staffRole === StaffRole.SUPERADMIN };
  }

  async forHome(user: AuthUser) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { id: true, name: true, orgId: true, installerId: true } });
    const r = await this.prisma.installationReport.findUnique({ where: { homeId: home.id }, include: { photos: { orderBy: { createdAt: 'asc' } } } });
    if (!r) return null;
    return { ...(await this.view(r, home.name)), canSign: !r.signedAt && user.role === Role.OWNER && !user.readOnly };
  }

  /** Facts that tick some items by themselves (shown next to them; the installer still confirms). */
  async facts(homeId: string) {
    const [nodes, devices, acked, owner] = await Promise.all([
      this.prisma.node.findMany({ where: { homeId, status: NodeStatus.ADOPTED }, select: { name: true, online: true, rssi: true } }),
      this.prisma.device.findMany({ where: { node: { homeId } }, select: { id: true, type: true, state: { select: { state: true } } } }),
      this.prisma.command.groupBy({ by: ['deviceId'], where: { status: CommandStatus.ACKED, device: { node: { homeId } } } }),
      this.prisma.membership.findFirst({ where: { homeId, role: Role.OWNER }, select: { user: { select: { name: true } } } }),
    ]);
    const switches = devices.filter((d) => d.type === 'switch');
    const sensors = devices.filter((d) => d.type !== 'switch');
    const weak = nodes.filter((n) => n.rssi !== null && n.rssi < -80);
    const ackedIds = new Set(acked.map((a) => a.deviceId));
    const reading = sensors.filter((d) => d.state && Object.keys(d.state.state as object).length > 0);
    return {
      wifi: { ok: nodes.length > 0 && nodes.every((n) => n.online) && weak.length === 0,
        text: nodes.length ? `${nodes.filter((n) => n.online).length} of ${nodes.length} boards online${weak.length ? `; weak signal: ${weak.map((n) => `${n.name} (${n.rssi} dBm)`).join(', ')}` : ''}` : 'No boards yet' },
      devices: { ok: switches.length > 0 && switches.every((d) => ackedIds.has(d.id)),
        text: `${switches.filter((d) => ackedIds.has(d.id)).length} of ${switches.length} switches confirmed from the app` },
      sensors: { ok: reading.length === sensors.length, text: sensors.length ? `${reading.length} of ${sensors.length} sensors have a reading` : 'No sensors' },
      owner: { ok: !!owner, text: owner ? `${owner.user.name} has joined` : 'The owner hasn’t joined yet' },
    };
  }

  private async view(r: Prisma.InstallationReportGetPayload<{ include: { photos: true } }>, homeName: string) {
    const facts = await this.facts(r.homeId);
    const installer = r.installerId ? await this.prisma.user.findUnique({ where: { id: r.installerId }, select: { name: true } }) : null;
    const items = (r.items as unknown as Item[]).map((i) => {
      const auto = CHECKLIST.find((c) => c.key === i.key)?.auto as keyof typeof facts | undefined;
      return { ...i, check: auto ? facts[auto] : null };
    });
    const exp = Date.now() + 2 * 3600_000;
    return {
      id: r.id, homeId: r.homeId, home: homeName, installer: installer?.name ?? null, items, notes: r.notes,
      done: items.filter((i) => i.done).length, total: items.length,
      signed: !!r.signedAt, signedName: r.signedName, signedAt: r.signedAt, signature: r.signature,
      photos: r.photos.map((p) => ({ id: p.id, caption: p.caption, size: p.size, createdAt: p.createdAt, url: `/api/installation/photos/${p.id}?exp=${exp}&sig=${this.photoSig(p.id, exp)}` })),
      updatedAt: r.updatedAt,
    };
  }

  // ---------------------------------------------------------------- the installer's work
  async update(staff: AuthUser, homeId: string, input: { items?: { key: string; done: boolean; note?: string }[]; notes?: string }) {
    const home = await this.staffHome(staff, homeId, true);
    const r = await this.report(home);
    if (r.signedAt) throw new BadRequestException('The customer has signed this report. A super admin can open it again to change it.');
    const items = (r.items as unknown as Item[]).map((i) => {
      const change = input.items?.find((x) => x.key === i.key);
      return change ? { ...i, done: change.done, ...(change.note !== undefined ? { note: change.note.slice(0, 300) } : {}) } : i;
    });
    await this.prisma.installationReport.update({
      where: { id: r.id }, data: { items: items as unknown as Prisma.InputJsonValue, ...(input.notes !== undefined ? { notes: input.notes.slice(0, 4000) } : {}), installerId: r.installerId ?? home.installerId },
    });
    return this.forStaff(staff, homeId);
  }

  async addPhoto(staff: AuthUser, homeId: string, file: Express.Multer.File | undefined, caption: string) {
    const home = await this.staffHome(staff, homeId, true);
    const r = await this.report(home);
    if (r.signedAt) throw new BadRequestException('The report is signed. A super admin can open it again to add photos.');
    if (!file?.buffer?.length) throw new BadRequestException('No photo received.');
    const ext = PHOTO_TYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Send a JPEG, PNG or WebP photo.');
    if (r.photos.length >= MAX_PHOTOS) throw new BadRequestException(`At most ${MAX_PHOTOS} photos per installation.`);
    const photo = await this.prisma.installPhoto.create({ data: { reportId: r.id, caption: caption.trim().slice(0, 140), mime: file.mimetype, size: file.size, byId: staff.id } });
    await mkdir(this.dir(r.id), { recursive: true });
    await writeFile(this.file(r.id, photo.id), file.buffer);
    return this.forStaff(staff, homeId);
  }

  async removePhoto(staff: AuthUser, homeId: string, photoId: string) {
    const home = await this.staffHome(staff, homeId, true);
    const r = await this.report(home);
    if (r.signedAt) throw new BadRequestException('The report is signed.');
    const p = await this.prisma.installPhoto.findFirst({ where: { id: photoId, reportId: r.id } });
    if (!p) throw new NotFoundException('No such photo.');
    await this.prisma.installPhoto.delete({ where: { id: p.id } });
    await rm(this.file(r.id, p.id), { force: true });
    return this.forStaff(staff, homeId);
  }

  // ---------------------------------------------------------------- signing
  /** The customer signs: on the installer's phone (staff route) or their own (the owner). */
  async sign(by: AuthUser, homeId: string, input: { name: string; signature: string }, asStaff: boolean) {
    const home = asStaff
      ? await this.staffHome(by, homeId, true)
      : await this.prisma.home.findUniqueOrThrow({ where: { id: homeId }, select: { id: true, name: true, orgId: true, installerId: true } });
    if (!asStaff && (by.role !== Role.OWNER || by.readOnly)) throw new ForbiddenException('The home’s owner signs the installation.');
    const r = await this.report(home);
    if (r.signedAt) throw new BadRequestException('Already signed.');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.signature) || input.signature.length > 400_000) throw new BadRequestException('Draw the signature again.');
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException('Write the name of the person signing.');
    const items = r.items as unknown as Item[];
    const open = items.filter((i) => !i.done);
    if (open.length) throw new BadRequestException(`Tick every item first (${open.length} left: ${open.map((i) => i.label).slice(0, 2).join('; ')}${open.length > 2 ? '…' : ''}).`);
    await this.prisma.installationReport.update({ where: { id: r.id }, data: { signedName: name.slice(0, 80), signedAt: new Date(), signature: input.signature, signedById: by.id } });
    await this.audit.record(home.id, by.id, 'installation.signed', r.id, { name, photos: r.photos.length }, home.orgId);
    const owners = await this.prisma.membership.findMany({ where: { homeId: home.id, role: { in: [Role.OWNER, Role.ADMIN] } }, select: { userId: true } });
    await this.monitoring.notify(home.id, [...owners.map((o) => o.userId), ...(home.installerId ? [home.installerId] : [])].filter((id) => id !== by.id), {
      kind: 'installation', severity: 'INFO', title: `${home.name}: installation signed off`, body: `Signed by ${name}. The report and photos are in the app.`, link: `/installation?home=${home.id}`,
    });
    return asStaff ? this.forStaff(by, homeId) : this.forHome(by);
  }

  async reopen(staff: AuthUser, homeId: string) {
    if (staff.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can open a signed report again.');
    const home = await this.staffHome(staff, homeId, true);
    const r = await this.report(home);
    await this.prisma.installationReport.update({ where: { id: r.id }, data: { signedAt: null, signedName: null, signature: null, signedById: null } });
    await this.audit.record(home.id, staff.id, 'installation.reopened', r.id, { wasSignedBy: r.signedName }, home.orgId);
    return this.forStaff(staff, homeId);
  }

  // ---------------------------------------------------------------- photos on disk, behind signed links
  async photo(id: string, exp: number, sig: string) {
    if (!Number.isFinite(exp) || exp < Date.now() || !this.validSig(id, exp, sig)) throw new ForbiddenException('This link has expired. Open the page again.');
    const p = await this.prisma.installPhoto.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('No such photo.');
    return { path: this.file(p.reportId, p.id), mime: p.mime };
  }

  private dir(reportId: string) {
    return resolve(join(this.settings.filesDir, 'installations', reportId));
  }
  private file(reportId: string, photoId: string) {
    return join(this.dir(reportId), photoId);
  }
  private photoSig(id: string, exp: number) {
    return createHmac('sha256', this.settings.jwtSecret).update(`photo:${id}:${exp}`).digest('hex').slice(0, 32);
  }
  private validSig(id: string, exp: number, sig: string) {
    const want = Buffer.from(this.photoSig(id, exp));
    const got = Buffer.from(String(sig));
    return want.length === got.length && timingSafeEqual(want, got);
  }
}
