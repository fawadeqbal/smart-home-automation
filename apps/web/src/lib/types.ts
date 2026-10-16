/** Shapes returned by the API (apps/api). */

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
export type StaffRole = 'SUPERADMIN' | 'INSTALLER' | 'SUPPORT';
export type Access = 'VIEW' | 'CONTROL' | 'MANAGE';
export type Plan = 'STARTER' | 'PRO' | 'BUSINESS';
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

export interface CurrentHome {
  id: string;
  name: string;
  city: string;
  timezone: string;
  role: Role;
  /** access comes from the staff role, not a membership */
  viaStaff: boolean;
  readOnly: boolean;
  canSetup: boolean;
  /** has seen the first-visit tour of this home (always true for staff looking in) */
  onboarded: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  staff: {
    role: StaffRole;
    org: { id: string; name: string; plan: Plan; planName: string; status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; trialEndsAt: string | null;
      logo: string | null; onboarded: boolean;
      /** your own company on your own server: no plans or limits */
      selfHosted?: boolean };
  } | null;
  homes: { id: string; name: string; city: string; role: Role }[];
  home: CurrentHome | null;
  role: Role | null;
  rooms: { roomId: string; access: Access }[];
}

/* ---------------------------------------------------------------- platform console */
export interface Overview {
  generatedAt: string;
  kpis: {
    homes: number; settingUp: number; people: number; staff: number;
    boardsInstalled: number; boardsOnline: number; inStock: number; assigned: number;
    commands: number; confirmed: number; failed: number; byChannel: Record<string, number>;
  };
  attention: { tone: Tone; title: string; homeId: string; home: string; detail: string; at: string | null; tab: string; nodeId?: string; href?: string }[];
  /** visit requests from the website still waiting for a call */
  visitsWaiting: number;
  attentionCount: number;
  services: { key: string; name: string; ok: boolean; line: string; metric: string }[];
  allOk: boolean;
  bars: { hour: string; ok: number; bad: number }[];
  currentFirmware: string | null;
}

export interface HomeRow {
  id: string; name: string; city: string; timezone: string;
  owner: string | null; ownerPending: boolean; installer: string | null; installerId: string | null;
  status: 'live' | 'setup' | 'attention' | 'archived'; tone: Tone; statusLabel: string;
  steps: number; stepFlags: boolean[]; boardsOnline: number; boardsTotal: number; boardsInstalled: number; people: number;
  lastActivity: string; lastActivityLabel: string;
}

export interface WorkspaceBoard {
  id: string; name: string; location: string | null; board: string; model: string;
  status: 'STOCK' | 'ASSIGNED' | 'ADOPTED' | 'FAULTY'; online: boolean; cond: Tone; condText: string;
  firmware: string | null; firmwareOld: boolean; devices: number; pinsUsed: number; pinsTotal: number;
  rssi: number | null; vcc: number | null; lastSeenAt: string | null; lastSeen: string;
}

export interface Workspace {
  home: {
    id: string; name: string; city: string; timezone: string; archived: boolean; createdAt: string;
    owner: { id: string; name: string; email: string } | null;
    ownerInvite: { email: string; name: string | null; sentAt: string } | null;
    installer: { id: string; name: string; email: string } | null;
    status: HomeRow['status']; statusLabel: string; tone: Tone;
  };
  steps: { n: number; title: string; detail: string; action: string; done: boolean; current: boolean }[];
  stepsDone: number;
  stats: { boardsOnline: number; boardsTotal: number; devices: number; people: number };
  boards: WorkspaceBoard[];
  rooms: { id: string; name: string; devices: number; on: number; offline: boolean; boards: string[] }[];
  unroomed: number;
  currentFirmware: string | null;
}

export interface InventoryBoard {
  id: string; board: string; model: string; status: WorkspaceBoard['status'];
  homeId: string | null; homeName: string | null; location: string | null;
  installerId: string | null; installer: string | null;
  firmware: string | null; firmwareOld: boolean; mac: string | null; ip: string | null;
  online: boolean; lastSeen: string; cond: Tone; condText: string; note: string | null;
  devices: number; addedAt: string; added: string;
}

export interface Inventory {
  boards: InventoryBoard[];
  homes: { id: string; name: string; installerId: string | null }[];
  installers: { id: string; name: string; staffRole: StaffRole }[];
  currentFirmware: string | null;
  models: { type: string; name: string }[];
}

export interface AuditRow {
  id: string; at: string; when: string; who: string; role: string; system: boolean;
  action: string; category: 'setup' | 'access' | 'devices' | 'system' | 'billing'; target: string;
  homeId: string | null; homeName: string;
}

export interface StaffList {
  people: { id: string; name: string; email: string; staffRole: StaffRole; roleLabel: string; disabled: boolean; homes: number; since: string; me: boolean }[];
  invites: { id: string; email: string; name: string | null; staffRole: StaffRole; sentAt: string; expiresAt: string }[];
}

export interface OrgDetails {
  id: string; name: string; plan: Plan; status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; trialEndsAt: string | null;
  billingEmail: string | null; billingName: string | null; taxId: string | null; country: string | null; createdAt: string;
  logo: string | null; cities: string[]; teamSize: string | null; onboarded: boolean;
  usage: { homes: number; boards: number; staff: number };
  limits: { homes: number | null; boards: number | null; staff: number | null };
  selfHosted?: boolean;
  plans: { id: Plan; name: string; priceUsd: number; homes: number | null; boards: number | null; staff: number | null; blurb: string }[];
  paymentsConnected: boolean;
}

export interface Invite { id: string; email: string; name: string | null; role: Role; expiresAt: string; createdAt: string }

export interface StateField {
  key: string;
  label: string;
  unit?: string;
}

export interface Device {
  id: string;
  key: string;
  name: string;
  aliases: string[];
  type: string;
  typeLabel: string;
  controllable: boolean;
  stateFields: StateField[];
  nodeId: string;
  nodeName: string;
  online: boolean;
  roomId: string | null;
  roomName: string | null;
  pin: number;
  pinLabel: string;
  activeLow: boolean;
  settings: Record<string, unknown>;
  enabled: boolean;
  state: Record<string, unknown> | null;
  source: string | null;
  updatedAt: string | null;
  access: Access;
}

export interface Room {
  id: string;
  name: string;
  order: number;
  access: Access;
}

export interface BoardPin {
  gpio: number;
  label: string;
  uses: ('output' | 'input' | 'sensor' | 'analog')[];
  note?: string;
}

export interface Catalog {
  boards: { type: string; name: string; pins: BoardPin[] }[];
  deviceTypes: { type: string; label: string; pinUse: string; controllable: boolean; hasActiveLow: boolean; stateFields: StateField[] }[];
  inputTypes: { type: string; label: string; pinUse: string }[];
}

export interface NodeDevice {
  id: string;
  key: string;
  name: string;
  type: string;
  pin: number;
  activeLow: boolean;
  roomId: string | null;
  settings: Record<string, unknown>;
  enabled: boolean;
  aliases: string[];
  state: Record<string, unknown> | null;
}

export interface BoardNode {
  id: string;
  name: string;
  board: string;
  status: 'STOCK' | 'ASSIGNED' | 'ADOPTED' | 'FAULTY';
  boardName?: string;
  online: boolean;
  firmware: string | null;
  ip: string | null;
  mac?: string | null;
  /** where it reaches the server from (the home's internet address), its place and provider */
  publicIp?: string | null;
  publicPlace?: string | null;
  publicIsp?: string | null;
  rssi: number | null;
  lastSeenAt: string | null;
  configRev: number;
  appliedRev: number;
  configError: string | null;
  health: BoardHealth | null;
  devices: NodeDevice[];
  inputs: { id: string; type: string; pin: number; targetId: string; targetName: string; settings: Record<string, unknown> }[];
}

export interface FamilyMember {
  id: string;
  name: string;
  email: string;
  /** null for the installer row (staff) */
  role: Role | null;
  staff: StaffRole | null;
  disabled: boolean;
  joinedAt: string;
  rooms: { roomId: string; access: Access }[];
}

export interface HistoryEntry {
  state: Record<string, unknown>;
  source: string;
  at: string;
}

/** What a board reports about itself every minute (firmware 2.1+ sends all fields). */
export interface BoardHealth {
  at: string;
  rssi?: number;
  heap?: number;
  heapFrag?: number;
  maxBlock?: number;
  uptime?: number;
  vcc?: number; // millivolts
  cpuMhz?: number;
  flashKb?: number;
  sketchKb?: number;
  freeSketchKb?: number;
  reset?: string;
  ssid?: string;
  channel?: number;
  connects?: number;
  bssid?: string;
  gateway?: string;
  mac?: string;
}

export interface ScheduleAction { deviceId: string; on: boolean; deviceName: string }
export interface Schedule {
  id: string;
  name: string;
  kind: 'ONCE' | 'DAILY';
  runAt: string | null;
  time: string | null;
  days: number[];
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  sceneId: string | null;
  sceneName: string | null;
  actions: ScheduleAction[];
  createdBy: string;
  createdById: string;
}
export interface Scene {
  id: string;
  name: string;
  icon: string;
  createdBy: string;
  canRun: boolean;
  actions: ScheduleAction[];
}

export type VisitStatus = 'NEW' | 'CONTACTED' | 'SCHEDULED' | 'CUSTOMER' | 'CLOSED';
export interface VisitRequest {
  id: string; name: string; phone: string; city: string; homeSize: string; status: VisitStatus; statusLabel: string;
  note: string; createdAt: string; updatedAt: string; home: { id: string; name: string } | null; handledBy: string | null;
}
export interface VisitList { counts: Record<VisitStatus, number>; requests: VisitRequest[] }

// ---------------------------------------------------------------- Help Center
export type HelpCategory = 'USAGE' | 'TROUBLESHOOTING' | 'PROCESS' | 'POLICY' | 'FAQ';
export type HelpAudience = 'EVERYONE' | 'STAFF';
export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  category: HelpCategory;
  audience: HelpAudience;
  tags: string[];
  body: string;
  published: boolean;
  updatedAt: string;
}
/** One article on its own page in the console. */
export interface HelpArticleFull extends HelpArticle {
  createdAt: string;
  /** who last changed it; null for a starter article nobody has edited */
  updatedBy: string | null;
  /** came with the app and nobody has changed it (new versions of the app keep it up to date) */
  starter: boolean;
}
/** What the assistant's search found for a test question. */
export interface HelpHit {
  articleId: string;
  title: string;
  category: HelpCategory;
  audience: HelpAudience;
  text: string;
  score: number;
  keywordRank: number | null;
  meaningRank: number | null;
}
