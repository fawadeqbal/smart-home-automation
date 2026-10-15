import { BadGatewayException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { HelpAudience, HelpCategory, Prisma } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { SETTINGS, Settings } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export interface ArticleInput {
  title: string;
  category: HelpCategory;
  audience: HelpAudience;
  tags: string[];
  body: string;
  published: boolean;
}

/** A starter article from apps/api/help/<category>/<name>.md. */
interface Starter extends ArticleInput {
  slug: string;
}

const HELP_DIR = process.env.HELP_DIR ?? path.join(__dirname, '..', '..', 'help');

/**
 * The Help Center: what the assistant knows about the product, fixing problems, the company's
 * processes and its policies.
 *
 * Every company starts with the starter articles shipped in apps/api/help (policies as drafts). A new
 * version of the app adds starter articles a company doesn't have yet; it never changes or brings back
 * ones the company edited or removed (matched by slug).
 */
@Injectable()
export class HelpService implements OnApplicationBootstrap {
  private readonly log = new Logger('Help');
  private starters: Starter[] | null = null;
  private readonly seeded = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  async onApplicationBootstrap() {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) await this.ensureSeeded(org.id).catch((e) => this.log.warn(`Starter articles for ${org.id}: ${e}`));
  }

  // ---------------------------------------------------------------- the console (staff)
  async list(user: AuthUser) {
    const orgId = this.staffOrg(user);
    await this.ensureSeeded(orgId);
    return this.prisma.helpArticle.findMany({
      where: { orgId, archivedAt: null },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
      select: { id: true, slug: true, title: true, category: true, audience: true, tags: true, body: true, published: true, updatedAt: true },
    });
  }

  async create(user: AuthUser, input: ArticleInput) {
    const orgId = this.staffOrg(user);
    const slug = `custom/${slugify(input.title)}-${Date.now().toString(36)}`;
    return this.prisma.helpArticle.create({ data: { ...input, orgId, slug, updatedById: user.id } });
  }

  async update(user: AuthUser, id: string, input: Partial<ArticleInput>) {
    await this.mine(user, id);
    return this.prisma.helpArticle.update({ where: { id }, data: { ...input, updatedById: user.id } });
  }

  /** Removed from the Help Center (kept as archived, so the starter set doesn't bring it back). */
  async remove(user: AuthUser, id: string) {
    await this.mine(user, id);
    await this.prisma.helpArticle.update({ where: { id }, data: { archivedAt: new Date(), published: false, updatedById: user.id } });
  }

  /** "Ask a test question": what the assistant would find for it (published articles only). */
  async tryQuestion(user: AuthUser, question: string, staffView: boolean) {
    const token = await this.auth.onBehalfToken(user);
    let res: Response;
    try {
      res = await fetch(`${this.settings.assistantUrl}/v1/help/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Assistant-Secret': this.settings.assistantSecret },
        body: JSON.stringify({ question, token, staff: staffView }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ServiceUnavailableException('The assistant is not running.');
    }
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    if (!res.ok) throw new BadGatewayException(data.detail ?? `Assistant error ${res.status}`);
    return data;
  }

  // ---------------------------------------------------------------- what the assistant reads
  /**
   * The published articles this person may be told about: their home's company, and STAFF articles
   * only for that company's staff. `key` changes whenever any of them does (the assistant caches its
   * search index under it).
   */
  async feed(user: AuthUser, withArticles: boolean, staffView?: boolean) {
    const orgId = await this.orgOf(user);
    if (!orgId) return { key: 'none', articles: [] };
    await this.ensureSeeded(orgId);
    const isStaff = !!user.staffRole && user.orgId === orgId;
    const staff = isStaff && (staffView ?? true);
    const where: Prisma.HelpArticleWhereInput = {
      orgId, published: true, archivedAt: null, ...(staff ? {} : { audience: HelpAudience.EVERYONE }),
    };
    const stats = await this.prisma.helpArticle.aggregate({ where, _count: true, _max: { updatedAt: true } });
    const key = `${orgId}:${staff ? 'staff' : 'everyone'}:${stats._count}:${stats._max.updatedAt?.getTime() ?? 0}`;
    if (!withArticles) return { key };
    const articles = await this.prisma.helpArticle.findMany({
      where,
      select: { id: true, title: true, category: true, audience: true, tags: true, body: true, updatedAt: true },
    });
    return { key, articles };
  }

  // ---------------------------------------------------------------- starter articles
  async ensureSeeded(orgId: string) {
    if (this.seeded.has(orgId)) return;
    const have = new Set((await this.prisma.helpArticle.findMany({ where: { orgId }, select: { slug: true } })).map((a) => a.slug));
    const missing = this.loadStarters().filter((s) => !have.has(s.slug));
    if (missing.length) {
      await this.prisma.helpArticle.createMany({ data: missing.map((s) => ({ ...s, orgId })), skipDuplicates: true });
      this.log.log(`Added ${missing.length} starter article${missing.length === 1 ? '' : 's'} for ${orgId}`);
    }
    this.seeded.add(orgId);
  }

  private loadStarters(): Starter[] {
    if (this.starters) return this.starters;
    const out: Starter[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md') && entry.name !== 'REVIEW.md' && entry.name !== 'README.md') {
          const parsed = parseArticle(fs.readFileSync(full, 'utf8'));
          if (parsed) out.push({ ...parsed, slug: path.relative(HELP_DIR, full).replace(/\\/g, '/').replace(/\.md$/, '') });
          else this.log.warn(`Skipped ${full}: no title/category front matter`);
        }
      }
    };
    walk(HELP_DIR);
    this.starters = out;
    return out;
  }

  // ---------------------------------------------------------------- helpers
  private staffOrg(user: AuthUser): string {
    if (!user.orgId || !user.staffRole) throw new NotFoundException('This is for company staff.');
    return user.orgId;
  }

  private async orgOf(user: AuthUser): Promise<string | null> {
    if (user.homeId) {
      const home = await this.prisma.home.findUnique({ where: { id: user.homeId }, select: { orgId: true } });
      if (home) return home.orgId;
    }
    return user.staffRole ? user.orgId : null;
  }

  private async mine(user: AuthUser, id: string) {
    const a = await this.prisma.helpArticle.findUnique({ where: { id }, select: { orgId: true, archivedAt: true } });
    if (!a || a.orgId !== this.staffOrg(user) || a.archivedAt) throw new NotFoundException('No such article.');
  }
}

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'article';
}

const CATEGORIES: Record<string, HelpCategory> = {
  usage: HelpCategory.USAGE, troubleshooting: HelpCategory.TROUBLESHOOTING, process: HelpCategory.PROCESS,
  policy: HelpCategory.POLICY, faq: HelpCategory.FAQ,
};

/**
 * A starter article: Markdown with a small front matter block (title, category, audience, tags,
 * published). Exported for the unit test.
 */
export function parseArticle(text: string): ArticleInput | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim();
  }
  const unquote = (v = '') => v.trim().replace(/^["']|["']$/g, '').trim();
  const title = unquote(meta.title);
  const category = CATEGORIES[unquote(meta.category).toLowerCase()];
  if (!title || !category) return null;
  const tags = unquote(meta.tags).replace(/^\[|\]$/g, '').split(',').map((t) => unquote(t)).filter(Boolean);
  return {
    title,
    category,
    audience: unquote(meta.audience).toLowerCase() === 'staff' ? HelpAudience.STAFF : HelpAudience.EVERYONE,
    tags,
    body: m[2]!.trim(),
    // policies are promises to customers: they start as drafts unless the file says otherwise
    published: meta.published ? unquote(meta.published).toLowerCase() === 'true' : category !== HelpCategory.POLICY,
  };
}
