import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { topics } from '@home/contracts';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { likelyVersions, versionInBinary, versionStrings } from '../common/version';
import { Settings, SETTINGS } from '../config';
import { LogsService } from '../hardware/logs.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const MAX_BYTES = 1_000_000; // a NodeMCU (4 MB, FS 2 MB) can take an image up to ~1 MB
const LINK_TTL_MS = 10 * 60000;

/** This PC's address on the home network, so a board can download from the API. */
export function lanAddress(): string | null {
  const all = Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) as { address: string }[];
  // home routers hand out 192.168.x.x (sometimes 10.x); 172.16-31 is usually Docker / WSL; VirtualBox uses 192.168.56.x
  const rank = (ip: string) => (ip.startsWith('192.168.56.') ? 3 : ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 4 : 2);
  return all.map((a) => a.address).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * Firmware updates over Wi-Fi (OTA). An owner uploads a build (Arduino: Sketch -> Export Compiled Binary),
 * then sends it to a board. The board downloads it with a signed link that expires in 10 minutes;
 * the x-MD5 header lets the board verify the image before switching to it.
 */
@Injectable()
export class FirmwareService implements OnModuleInit {
  private readonly log = new Logger('Firmware');
  private readonly pending = new Map<string, { version: string; at: number; by: string; installed?: boolean }>();
  private readonly listeners: ((nodeId: string, ok: boolean, version: string, message: string) => unknown)[] = [];

  /** Staged rollouts hear how each update ended (they depend on this service, so they can't be injected into it). */
  onResult(fn: (nodeId: string, ok: boolean, version: string, message: string) => unknown) {
    this.listeners.push(fn);
  }

  private result(nodeId: string, ok: boolean, version: string, message: string) {
    for (const fn of this.listeners) void Promise.resolve().then(() => fn(nodeId, ok, version, message)).catch((e) => this.log.warn(`firmware listener: ${e}`));
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly logs: LogsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  async onModuleInit() {
    await mkdir(this.settings.firmwareDir, { recursive: true });
  }

  /** The organization's builds, plus shared ones uploaded before organizations existed. */
  list(user: AuthUser) {
    return this.prisma.firmwareImage.findMany({ where: { OR: [{ orgId: user.orgId }, { orgId: null }] }, orderBy: { createdAt: 'desc' } });
  }

  async upload(user: AuthUser, file: Express.Multer.File | undefined, version: string, notes: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the .bin file (Arduino: Sketch → Export Compiled Binary).');
    if (file.size > MAX_BYTES) throw new BadRequestException(`Too big (${Math.round(file.size / 1024)} KB): at most ${MAX_BYTES / 1000} KB.`);
    if (file.buffer[0] !== 0xe9) throw new BadRequestException('This is not an ESP8266 firmware image (.bin from Arduino “Export Compiled Binary”).');
    // the number a board reports after installing this file is the one compiled into it
    const stamped = versionInBinary(file.buffer);
    const typed = version.trim();
    if (stamped && typed && typed !== stamped) {
      throw new BadRequestException(
        `This file was built as firmware ${stamped} (FIRMWARE_VERSION in config.h), so boards will report ${stamped} after installing it — not ${typed}. ` +
        `Upload it as ${stamped}, or change FIRMWARE_VERSION to ${typed}, export again and upload that file.`);
    }
    if (!stamped && typed) {
      // an older build without the stamp: its version is still in it as plain text — it must match
      const found = versionStrings(file.buffer);
      if (found.length && !found.includes(typed)) {
        throw new BadRequestException(
          `This file is not firmware ${typed}: it looks like an older build (${likelyVersions(found, typed).join(' or ')}), and boards would keep reporting that. ` +
          'Upload the file Arduino just exported: firmware/home_node/build/<board>/home_node.ino.bin.');
      }
    }
    const v = stamped ?? typed;
    if (!v) throw new BadRequestException('Type the version: the FIRMWARE_VERSION in config.h this file was built with.');
    if (!/^[\w.\-+]{1,40}$/.test(v)) throw new BadRequestException('Version: letters, digits and . - + only, e.g. 2.2.0');
    const same = await this.prisma.firmwareImage.findFirst({ where: { version: v, OR: [{ orgId: user.orgId }, { orgId: null }] }, select: { id: true, orgId: true } });
    if (same) {
      // a stamped build replaces a same-numbered build that was not really that version (uploaded under the wrong number)
      const old = await readFile(this.path(same.id)).catch(() => null);
      const oldIsGenuine = !!old && (versionInBinary(old) === v || (!versionInBinary(old) && versionStrings(old).includes(v)));
      if (!stamped || oldIsGenuine || same.orgId !== user.orgId) {
        throw new BadRequestException(`Firmware ${v} is already uploaded. For a new build, raise FIRMWARE_VERSION in config.h (e.g. to ${this.bump(v)}), export again and upload that.`);
      }
      await this.prisma.firmwareImage.delete({ where: { id: same.id } });
      await unlink(this.path(same.id)).catch(() => undefined);
      await this.audit.record(null, user.id, 'firmware.replace', same.id, { version: v, reason: 'the old file was not really this version' }, user.orgId);
    }
    const md5 = createHash('md5').update(file.buffer).digest('hex');
    const image = await this.prisma.firmwareImage.create({ data: { orgId: user.orgId, version: v, notes: notes.slice(0, 300), size: file.size, md5, uploadedById: user.id } });
    await writeFile(this.path(image.id), file.buffer);
    await this.audit.record(null, user.id, 'firmware.upload', image.id, { version: v, size: file.size, stamped: !!stamped }, user.orgId);
    if (user.orgId) this.realtime.firmwareChanged(user.orgId);
    return image;
  }

  async remove(user: AuthUser, id: string) {
    const { count } = await this.prisma.firmwareImage.deleteMany({ where: { id, orgId: user.orgId } });
    if (!count) throw new NotFoundException('No such firmware (shared builds cannot be deleted here).');
    await unlink(this.path(id)).catch(() => undefined);
    await this.audit.record(null, user.id, 'firmware.remove', id, {}, user.orgId);
    if (user.orgId) this.realtime.firmwareChanged(user.orgId);
  }

  async install(user: AuthUser, nodeId: string, firmwareId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, homeId: user.homeId } });
    if (!node) throw new NotFoundException('No such board.');
    if (!node.online) throw new BadRequestException('The board is offline.');
    const image = await this.prisma.firmwareImage.findUnique({ where: { id: firmwareId } });
    const home = node.homeId ? await this.prisma.home.findUnique({ where: { id: node.homeId }, select: { orgId: true } }) : null;
    // the build must belong to the home's organization (or be a shared one), whoever sends it
    if (!image || !home || (image.orgId && image.orgId !== home.orgId) || user.orgId !== home.orgId) throw new NotFoundException('No such firmware.');
    const base = await this.send(nodeId, image, user.name);
    await this.audit.record(user.homeId, user.id, 'firmware.install', nodeId, { version: image.version, from: node.firmware });
    return { version: image.version, url: base };
  }

  /** Tells one board to download and install a build (checks are the caller's). */
  async send(nodeId: string, image: { id: string; version: string }, by: string) {
    const base = this.settings.publicApiUrl ?? (lanAddress() ? `http://${lanAddress()}:${this.settings.port}` : null);
    if (!base) throw new BadRequestException('Set PUBLIC_API_URL in .env so boards can reach this server.');
    const exp = Date.now() + LINK_TTL_MS;
    const url = `${base}/api/firmware/${image.id}/download?node=${nodeId}&exp=${exp}&sig=${this.sign(image.id, nodeId, exp)}`;
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'ota', url, version: image.version }, { qos: 1 });
    this.pending.set(nodeId, { version: image.version, at: Date.now(), by });
    this.logs.server(nodeId, 'info', `Firmware ${image.version} sent to the board by ${by} (it downloads from ${base})`);
    return base;
  }

  /** Checks a board's download link; returns the file path and its MD5. */
  async download(id: string, nodeId: string, exp: number, sig: string) {
    if (!(exp > Date.now()) || !this.validSig(id, nodeId, exp, sig)) throw new NotFoundException('Link expired or invalid.');
    const image = await this.prisma.firmwareImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('No such firmware.');
    this.logs.server(nodeId, 'info', `Board is downloading firmware ${image.version} (${Math.round(image.size / 1024)} KB)`);
    this.log.log(`Serving ${this.path(id)} to ${nodeId}`);
    // builds uploaded while FIRMWARE_DIR was empty (before 2.2.1 of the API) were saved in the working folder
    const legacy = resolve(`${id}.bin`);
    if (legacy !== this.path(id)) {
      await access(this.path(id)).catch(async () => { await rename(legacy, this.path(id)).catch(() => undefined); });
    }
    return { path: this.path(id), md5: image.md5, size: image.size };
  }

  /**
   * The board's own report after downloading: "installed, restarting" (it restarts 1.5 s later and announces
   * the version it now runs) or a failure (it keeps running the old firmware).
   */
  outcome(nodeId: string, homeId: string, ok: boolean, message: string, version?: string) {
    const p = this.pending.get(nodeId);
    if (!p) return;
    if (ok) p.installed = true;
    else {
      this.pending.delete(nodeId);
      this.result(nodeId, false, p.version, message);
    }
    this.logs.server(nodeId, ok ? 'info' : 'error', ok ? `Firmware ${version ?? p.version}: ${message}` : `Firmware update failed: ${message}`);
    this.realtime.nodesChanged(homeId, nodeId);
  }

  /** A board connected and said which firmware it runs: the end of an update, one way or the other. */
  announced(nodeId: string, homeId: string, fw: string | undefined) {
    const p = this.pending.get(nodeId);
    if (!p || !fw) return;
    if (fw === p.version) {
      this.pending.delete(nodeId);
      this.logs.server(nodeId, 'info', `Firmware ${fw}: now running after restart`);
      this.result(nodeId, true, fw, 'running');
    } else if (p.installed) {
      // it installed the file and restarted, but the file was built with another FIRMWARE_VERSION
      this.pending.delete(nodeId);
      const message = `installed the file and restarted, but reports firmware ${fw}, not ${p.version} — that file was built with FIRMWARE_VERSION "${fw}" in config.h`;
      this.logs.server(nodeId, 'warn', `Firmware update: ${message}`);
      this.realtime.nodeNetwork(homeId, { nodeId, ota: { ok: false, version: p.version, message } });
      this.result(nodeId, false, p.version, message);
    }
    this.realtime.nodesChanged(homeId, nodeId);
  }

  /** 2.2.0 -> 2.2.1 (a suggestion in messages). */
  private bump(v: string) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(v);
    return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${v}.1`;
  }

  private path(id: string) {
    return resolve(join(this.settings.firmwareDir, `${id}.bin`));
  }
  private sign(id: string, nodeId: string, exp: number) {
    return createHmac('sha256', this.settings.jwtSecret).update(`fw:${id}:${nodeId}:${exp}`).digest('hex').slice(0, 32);
  }
  private validSig(id: string, nodeId: string, exp: number, sig: string) {
    const want = Buffer.from(this.sign(id, nodeId, exp));
    const got = Buffer.from(String(sig));
    return want.length === got.length && timingSafeEqual(want, got);
  }
}
