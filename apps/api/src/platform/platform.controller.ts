import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Plan, StaffRole } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { PlatformService } from './platform.service';

const name = z.string().trim().min(1).max(80);
const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const createHome = z.object({
  name, city: z.string().trim().max(80).optional(), timezone: z.string().trim().max(60).optional(),
  installerId: z.string().nullable().optional(),
  owner: z.object({ name: z.string().trim().max(80).optional(), email }).nullable().optional(),
  rooms: z.array(z.string().trim().max(60)).max(30).optional(),
});
const updateHome = z.object({
  name: name.optional(), city: z.string().trim().max(80).optional(), timezone: z.string().trim().max(60).optional(),
  installerId: z.string().nullable().optional(), archived: z.boolean().optional(),
});
const addStock = z.object({ ids: z.array(z.string().max(64)).min(1).max(200), board: z.string(), note: z.string().trim().max(200).optional() });
const assign = z.object({ homeId: z.string().min(1), installerId: z.string().nullable().optional() });
const inviteStaff = z.object({ email, name: z.string().trim().max(80).optional(), staffRole: z.nativeEnum(StaffRole) });
const updateStaff = z.object({ staffRole: z.nativeEnum(StaffRole).optional(), disabled: z.boolean().optional() });
const orgSchema = z.object({
  name: name.optional(), billingEmail: email.nullable().optional(), billingName: z.string().trim().max(120).nullable().optional(),
  taxId: z.string().trim().max(40).nullable().optional(), country: z.string().trim().max(60).nullable().optional(),
});

const ALL = [StaffRole.SUPERADMIN, StaffRole.INSTALLER, StaffRole.SUPPORT] as const;

/** The platform console: an organization's homes, board inventory, staff, audit log and billing. */
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Staff('SUPERADMIN', 'SUPPORT')
  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.platform.overview(user);
  }

  @Staff(...ALL)
  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    return this.platform.search(user, String(q).slice(0, 80));
  }

  // ---------------------------------------------------------------- homes
  @Staff(...ALL)
  @Get('homes')
  homes(@CurrentUser() user: AuthUser) {
    return this.platform.homes(user);
  }

  @Staff('SUPERADMIN')
  @Post('homes')
  createHome(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createHome)) body: z.infer<typeof createHome>) {
    return this.platform.createHome(user, body);
  }

  @Staff(...ALL)
  @Get('homes/:id')
  workspace(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.workspace(user, id);
  }

  @Staff('SUPERADMIN')
  @Patch('homes/:id')
  updateHome(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateHome)) body: z.infer<typeof updateHome>) {
    return this.platform.updateHome(user, id, body);
  }

  // ---------------------------------------------------------------- inventory
  @Staff('SUPERADMIN', 'SUPPORT')
  @Get('inventory')
  inventory(@CurrentUser() user: AuthUser) {
    return this.platform.inventory(user);
  }

  @Staff('SUPERADMIN')
  @Post('inventory')
  addStock(@CurrentUser() user: AuthUser, @Body(new ZodPipe(addStock)) body: z.infer<typeof addStock>) {
    return this.platform.addStock(user, body.ids, body.board, body.note);
  }

  @Staff('SUPERADMIN')
  @Post('inventory/:id/assign')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(assign)) body: z.infer<typeof assign>) {
    return this.platform.assign(user, id, body.homeId, body.installerId);
  }

  @Staff('SUPERADMIN')
  @Post('inventory/:id/unassign')
  @HttpCode(200)
  unassign(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.unassign(user, id);
  }

  @Staff('SUPERADMIN')
  @Post('inventory/:id/faulty')
  @HttpCode(200)
  faulty(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ note: z.string().trim().max(300).default('') }))) body: { note: string }) {
    return this.platform.markFaulty(user, id, body.note);
  }

  @Staff('SUPERADMIN')
  @Post('inventory/:id/restock')
  @HttpCode(200)
  restock(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.restock(user, id);
  }

  @Staff('SUPERADMIN')
  @Delete('inventory/:id')
  @HttpCode(204)
  retire(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.retire(user, id);
  }

  // ---------------------------------------------------------------- staff (team)
  @Staff('SUPERADMIN')
  @Get('staff')
  staff(@CurrentUser() user: AuthUser) {
    return this.platform.staff(user);
  }

  @Staff('SUPERADMIN')
  @Post('staff/invites')
  inviteStaff(@CurrentUser() user: AuthUser, @Body(new ZodPipe(inviteStaff)) body: z.infer<typeof inviteStaff>) {
    return this.platform.inviteStaff(user, body.email, body.staffRole, body.name);
  }

  @Staff('SUPERADMIN')
  @Delete('staff/invites/:id')
  @HttpCode(204)
  revokeStaffInvite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.revokeStaffInvite(user, id);
  }

  @Staff('SUPERADMIN')
  @Patch('staff/:id')
  updateStaff(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateStaff)) body: z.infer<typeof updateStaff>) {
    return this.platform.updateStaff(user, id, body);
  }

  @Staff('SUPERADMIN')
  @Delete('staff/:id')
  @HttpCode(204)
  removeStaff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.removeStaff(user, id);
  }

  @Staff(...ALL)
  @Get('roles')
  roles(@CurrentUser() user: AuthUser) {
    return this.platform.roleCounts(user);
  }

  // ---------------------------------------------------------------- audit
  @Staff(...ALL)
  @Get('audit')
  audit(@CurrentUser() user: AuthUser, @Query('home') home?: string, @Query('category') category?: string, @Query('limit') limit?: string) {
    return this.platform.auditFor(user, home, category, Math.min(500, Math.max(1, Number(limit) || 100)));
  }

  @Staff('SUPERADMIN', 'SUPPORT')
  @Get('audit.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  async auditCsv(@CurrentUser() user: AuthUser, @Query('home') home?: string, @Query('category') category?: string) {
    const rows = await this.platform.auditFor(user, home, category, 5000);
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return ['When,Who,Role,Action,What,Home', ...rows.map((r) => [new Date(r.at).toISOString(), r.who, r.role, r.action, r.target, r.homeName].map(cell).join(','))].join('\n');
  }

  // ---------------------------------------------------------------- organization and billing
  @Staff(...ALL)
  @Get('org')
  org(@CurrentUser() user: AuthUser) {
    return this.platform.organization(user);
  }

  @Staff('SUPERADMIN')
  @Patch('org')
  updateOrg(@CurrentUser() user: AuthUser, @Body(new ZodPipe(orgSchema)) body: z.infer<typeof orgSchema>) {
    return this.platform.updateOrganization(user, body);
  }

  @Staff('SUPERADMIN')
  @Post('org/plan')
  @HttpCode(200)
  plan(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ plan: z.nativeEnum(Plan) }))) body: { plan: Plan }) {
    return this.platform.changePlan(user, body.plan);
  }
}
