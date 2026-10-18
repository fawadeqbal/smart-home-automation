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
  /** time-limited access: why I can't use the home right now (null: I can) */
  blocked?: { reason: 'expired' | 'hours'; message: string } | null;
  /** my limits here, when I have some */
  access?: (AccessLimitsValue & { summary: string | null; endsAt: string | null }) | null;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  /** two-step sign-in is on */
  twoFactor?: boolean;
  /** mobile number for WhatsApp messages from the company (optional) */
  phone?: string | null;
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
  /** why it was marked faulty */
  note?: string | null;
}

export interface Workspace {
  home: {
    id: string; name: string; city: string; timezone: string; archived: boolean; createdAt: string;
    owner: { id: string; name: string; email: string; phone?: string | null } | null;
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
  /** board swaps: the board that took over from this one, and the one this board replaced */
  replacedBy?: { id: string; at: string | null } | null;
  replaced?: { id: string; at: string } | null;
  /** marked faulty while still in its home: its devices wait for a replacement board */
  waiting?: boolean;
}

export interface Inventory {
  boards: InventoryBoard[];
  homes: { id: string; name: string; installerId: string | null }[];
  installers: { id: string; name: string; staffRole: StaffRole }[];
  currentFirmware: string | null;
  models: { type: string; name: string }[];
  /** boards in stock against the warning level (min 0: no warning) */
  stock?: { inStock: number; min: number; low: boolean };
}

export interface AuditRow {
  id: string; at: string; when: string; who: string; role: string; system: boolean;
  action: string; category: 'setup' | 'access' | 'devices' | 'system' | 'billing'; target: string;
  homeId: string | null; homeName: string;
}

export interface StaffList {
  people: { id: string; name: string; email: string; staffRole: StaffRole; roleLabel: string; disabled: boolean; homes: number; since: string; me: boolean; twoFactor?: boolean }[];
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
  bankAccount?: string | null; jazzcashNumber?: string | null; easypaisaNumber?: string | null;
  baseLat?: number | null; baseLng?: number | null; stockMin?: number;
}

export interface Invite { id: string; email: string; name: string | null; role: Role; expiresAt: string; createdAt: string; access?: string | null }

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
  /** its board was marked faulty: kept, waiting for a replacement board (can't be switched until then) */
  waiting?: boolean;
  roomId: string | null;
  roomName: string | null;
  pin: number;
  pinLabel: string;
  activeLow: boolean;
  settings: Record<string, unknown>;
  enabled: boolean;
  childLock?: boolean;
  autoOffMinutes?: number | null;
  autoOffAt?: string | null;
  watts?: number | null;
  /** stays off after a power cut (firmware 2.6.0+) */
  restoreOff?: boolean;
  /** a fan's number of speeds */
  speeds?: number;
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
  restoreOff?: boolean;
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
  /** the phone app can switch it over the home's Wi‑Fi without internet (firmware 2.5.0+) */
  localControl?: 'ready' | 'waiting' | 'old-firmware' | null;
  /** where it reaches the server from (the home's internet address), its place and provider */
  publicIp?: string | null;
  publicPlace?: string | null;
  publicIsp?: string | null;
  /** its server login (firmware 2.6.0+): its own or the shared one, since when, and whether it came back without its own */
  mqttLogin?: 'own' | 'shared' | null;
  mqttLoginSince?: string | null;
  mqttLoginProblem?: boolean;
  rssi: number | null;
  lastSeenAt: string | null;
  configRev: number;
  appliedRev: number;
  configError: string | null;
  health: BoardHealth | null;
  devices: NodeDevice[];
  inputs: BoardInput[];
  /** why it was marked faulty; `waiting`: it is out of service, its devices wait for a replacement board */
  note?: string | null;
  waiting?: boolean;
}

/** One wire of a board swap: the same pin number on the new board, and whether it can be used that way. */
export interface SwapPlanRow { what: string; name: string; gpio: number; use: string; from: string; to: string; problem: string | null }
export interface SwapCandidate {
  id: string; board: string; boardName: string; status: 'STOCK' | 'ASSIGNED'; online: boolean; lastSeenAt: string | null; firmware: string | null;
  plan: SwapPlanRow[]; problems: string[]; warnings: string[];
}
export interface Replacements {
  board: { id: string; name: string; board: string; boardName: string; status: BoardNode['status']; online: boolean; devices: number; inputs: number };
  plan: SwapPlanRow[];
  candidates: SwapCandidate[];
  models: { type: string; name: string }[];
}
export interface SwapResult { ok: boolean; newId: string; oldId: string; oldStatus: 'FAULTY' | 'STOCK'; devices: number; inputs: number; warnings: string[] }

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
  /** time-limited access (members and guests); null: none */
  access?: (AccessLimitsValue & { summary: string | null; status: 'active' | 'outside' | 'expired' }) | null;
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

export interface ScheduleAction { deviceId: string; on: boolean; deviceName: string; waiting?: boolean; problem?: string }
/** How the last run went: ok, waiting to try a device again, failed, or skipped (e.g. the server was down at its time). */
export type RunStatus = 'ok' | 'retrying' | 'failed' | 'skipped';
/** After the server was down: run late anyway, skip, or decide by what it does (a timer that switches things off still runs). */
export type IfMissed = 'auto' | 'run' | 'skip';
export interface Schedule {
  id: string;
  name: string;
  kind: 'ONCE' | 'DAILY' | 'SUN';
  sunEvent?: 'SUNRISE' | 'SUNSET' | null;
  offsetMin?: number;
  runAt: string | null;
  time: string | null;
  days: number[];
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  lastStatus?: RunStatus | null;
  retryAt?: string | null;
  ifMissed?: IfMissed;
  /** what can't run now: "Lamp: waiting for a replacement board" */
  problems?: string[];
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
  /** the phone as WhatsApp digits; the booked visit and who goes */
  whatsapp?: string | null; visitAt?: string | null; assigneeId?: string | null; assignee?: string | null;
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

/** Power cuts, Wi-Fi or internet outages and board restarts (worked out when a board comes back). */
export type OutageKind = 'POWER' | 'NETWORK' | 'RESTART' | 'RESET' | 'CRASH' | 'UNKNOWN';
export interface Outage {
  id: string; kind: OutageKind; label: string; board: string; startedAt: string; endedAt: string; seconds: number; reset: string | null;
}
export interface OutageSummary {
  powerCuts: number; powerSeconds: number; networkOuts: number; networkSeconds: number; restarts: number; crashes: number;
  lastPower: { startedAt: string; endedAt: string; seconds: number } | null;
}
export interface HomeOutages { days: number; timezone: string; summary: OutageSummary; outages: Outage[] }
export interface StaffOutages {
  days: number;
  homes: { homeId: string; home: string; power: number; powerSeconds: number; network: number; networkSeconds: number; crashes: number }[];
  areas: { place: string; startedAt: string; endedAt: string; seconds: number; homes: string[] }[];
  down: { boardId: string; board: string; homeId: string; home: string; place: string | null; since: string | null }[];
  outages: (Outage & { home: string; homeId: string })[];
}

// rules ("when this happens, do that"), away mode, where the home is
export type RuleEvent = 'on' | 'off' | 'opens' | 'closes' | 'above' | 'below' | 'gridOff' | 'gridOn';
export interface RuleTrigger { deviceId: string; deviceName: string; event: RuleEvent; value?: number; field?: 'temperature' | 'humidity' | 'level' }
export interface RuleConditions { from?: string; to?: string; days?: number[]; away?: boolean }
export type RuleAction =
  | { type: 'device'; deviceId: string; deviceName?: string; on: boolean; forMinutes?: number }
  | { type: 'scene'; sceneId: string; sceneName?: string }
  | { type: 'notify'; to: 'me' | 'admins' | 'everyone'; message?: string };
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleConditions;
  actions: RuleAction[];
  cooldownSec: number;
  lastFiredAt: string | null;
  lastResult: string | null;
  createdBy: string;
  createdById: string;
  summary: string;
  problems?: string[];
}
export interface AwayState {
  on: boolean;
  since: string | null;
  by: string | null;
  lights: string[];
  switches: { id: string; name: string; room: string | null }[];
  eveningFrom: string | null;
  eveningTo: string;
}
export interface HomeLocation {
  lat: number;
  lon: number;
  source: 'set' | 'city' | 'board' | 'default';
  label: string;
  sunrise: string | null;
  sunset: string | null;
  timezone: string;
  cities: string[];
}

export interface EnergyDevice { id: string; name: string; room: string | null; watts: number; wattsSource: 'set' | 'guessed' | 'unknown'; hours: number; kwh: number; cost: number; onNow: boolean }
export interface Energy {
  days: number;
  timezone: string;
  tariff: number;
  tariffSet: boolean;
  currency: string;
  total: { kwh: number; cost: number; hours: number };
  month: { kwh: number; cost: number };
  perDay: { day: string; kwh: number; cost: number }[];
  devices: EnergyDevice[];
  unknown: number;
  powerCuts: number;
}

// service tickets
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export interface TicketMessage { id: string; body: string; at: string; by: string | null; staff: boolean; event: boolean; internal?: boolean; mine?: boolean }
export interface Ticket {
  id: string;
  number: number;
  title: string;
  category: string;
  status: TicketStatus;
  statusText: string;
  priority: TicketPriority;
  homeId: string;
  home: string;
  city: string;
  nodeId: string | null;
  openedById: string;
  openedBy: string | null;
  assigneeId: string | null;
  assignee: string | null;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  messages: TicketMessage[];
  last?: { by: string | null; text: string; internal: boolean; at: string } | null;
  staff?: { id: string; name: string; staffRole: string }[];
  node?: { id: string; name: string; online: boolean } | null;
  rating?: number | null; ratingComment?: string | null; ratedAt?: string | null;
  /** the home's side: may rate it now, and until when a rating can be changed */
  canRate?: boolean; rateUntil?: string | null;
  /** the team's side: who to send a WhatsApp update to */
  contact?: Contact | null; company?: string;
}
export interface TicketQueue { tickets: Ticket[]; open: number; overdue: number }

// installation report
export interface InstallItem { key: string; label: string; done: boolean; note?: string; check: { ok: boolean; text: string } | null }
export interface InstallReport {
  id: string;
  homeId: string;
  home: string;
  installer: string | null;
  items: InstallItem[];
  notes: string;
  done: number;
  total: number;
  signed: boolean;
  signedName: string | null;
  signedAt: string | null;
  signature: string | null;
  photos: { id: string; caption: string; size: number; createdAt: string; url: string }[];
  updatedAt: string;
  canEdit?: boolean;
  canReopen?: boolean;
  canSign?: boolean;
  /** what the customer accepted in their quote(s) */
  toInstall?: { quotes: { ref: string; acceptedAt: string | null }[]; items: { name: string; unit: string; qty: number }[] };
}

// billing
export type BillingPeriod = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export interface Contract {
  id: string; homeId: string; home: string; city: string; plan: string; amount: number; period: BillingPeriod; periodText: string; perMonth: number;
  visitsIncluded: number; startsOn: string; endsOn: string | null; nextInvoiceOn: string; status: 'ACTIVE' | 'PAUSED' | 'ENDED'; notes: string;
}
export interface Invoice {
  id: string; number: number; homeId: string; home: string; city: string; contractId: string | null; description: string; amount: number;
  issuedOn: string; dueOn: string; status: 'DUE' | 'PAID' | 'VOID'; late: boolean; paidOn: string | null; method: string | null; reference: string | null;
}
export interface BillingOverview {
  kpis: { perMonth: number; active: number; due: number; dueCount: number; late: number; lateCount: number; paidThisMonth: number };
  contracts: Contract[]; invoices: Invoice[]; canEdit: boolean;
  company?: { name: string; pay: PayDetails }; contacts?: Record<string, Contact>; renewals?: number;
}
export interface HomeBilling { company: string; contract: Contract | null; invoices: Invoice[]; due: number; pay?: PayDetails }
export interface PrintableInvoice extends Invoice {
  company: { name: string; billingEmail: string | null; taxId: string | null; logo: string | null };
  billTo: { home: string; city: string; owner: { name: string; email: string } | null };
  contract: { plan: string; period: BillingPeriod } | null;
  pay?: PayDetails; contact?: Contact | null;
}

// staged firmware rollouts
export type RolloutStatus = 'RUNNING' | 'PAUSED' | 'HALTED' | 'DONE' | 'CANCELLED';
export interface RolloutTarget {
  id: string; nodeId: string; name: string; home: string | null; homeId: string | null; online: boolean; rssi: number | null; firmware: string | null;
  wave: number; status: 'PENDING' | 'SENT' | 'DONE' | 'FAILED' | 'SKIPPED'; fromVersion: string | null; sentAt: string | null; doneAt: string | null; note: string | null;
}
export interface Rollout {
  id: string; version: string; status: RolloutStatus; wave: number; waves: number; waveSize: number; waveGapMin: number; maxFailures: number;
  daytimeOnly: boolean; skipWeak: boolean; nextWaveAt: string | null; haltReason: string | null; createdAt: string; finishedAt: string | null;
  counts: { total: number; pending: number; sent: number; done: number; failed: number; skipped: number };
  targets: RolloutTarget[];
}
export interface RolloutList { images: { id: string; version: string; notes: string; createdAt: string }[]; canEdit: boolean; rollouts: Rollout[] }

// wall buttons and switches on a board
export type InputGesture = 'single' | 'double' | 'long' | 'flip';
export type InputAction = { type: 'device'; deviceId: string; on?: boolean } | { type: 'scene'; sceneId: string } | { type: 'allOff'; roomId?: string | null };
export interface BoardInput {
  id: string; type: 'toggle_button' | 'wall_switch' | string; pin: number; name: string; targetId: string | null; targetName: string | null;
  settings: Record<string, unknown>; actions: Partial<Record<InputGesture, InputAction>>; lastEventAt: string | null;
}

// ---------------------------------------------------------------- service: WhatsApp, renewals, quotes, the day, ratings
/** Who to message about a home, and their number as WhatsApp digits (null: use the share sheet). */
export interface Contact { name: string | null; whatsapp: string | null }
export interface PayDetails { bank: string | null; jazzcash: string | null; easypaisa: string | null }

export interface Renewal extends Contract { daysLeft: number; ended: boolean; contact: Contact | null }
export interface RenewalList { windowDays: number; lapsedDays: number; company: { name: string; pay: PayDetails }; canEdit: boolean; contracts: Renewal[] }

export interface PriceItem { id: string; name: string; unit: string; price: number }
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';
export interface QuoteLine { priceItemId: string | null; name: string; unit: string; qty: number; price: number; total?: number }
export interface Quote {
  id: string; number: number; ref: string; status: QuoteStatus; customerName: string; city: string;
  items: QuoteLine[]; subtotal: number; discount: number; total: number; note: string; validUntil: string | null;
  sentAt: string | null; decidedAt: string | null; decidedName: string | null; declineReason: string | null; convertedAt: string | null;
  home: { id: string; name: string; installerId: string | null } | null; createdBy: string | null; company: string;
  whatsapp: string | null; path: string; visitRequestId: string | null; homeId: string | null; createdAt: string; updatedAt: string;
}
export interface QuoteList { quotes: Quote[]; canEdit: boolean; canConvert: boolean }
/** The customer's page (by the secret link). */
export interface PublicQuote {
  id: string; number: number; ref: string; status: QuoteStatus; customerName: string; city: string;
  items: (QuoteLine & { total: number })[]; subtotal: number; discount: number; total: number; note: string; validUntil: string | null;
  sentAt: string | null; decidedAt: string | null; decidedName: string | null;
  company: { name: string; logo: string | null; billingEmail: string | null }; expired: boolean; canAnswer: boolean;
}

export interface DayJob { type: 'visit' | 'install' | 'ticket'; title: string; detail: string; at: string | null; link: string; priority?: string }
export interface DayStop {
  key: string; n: number; kind: 'home' | 'visit'; name: string; city: string; lat: number | null; lng: number | null; located: boolean;
  homeId: string | null; visitRequestId: string | null; phone: string | null; whatsapp: string | null; legKm: number | null;
  directions: string | null; jobs: DayJob[];
}
export interface InstallerDay {
  date: string; installer: { id: string; name: string } | null; installers: { id: string; name: string; staffRole: StaffRole }[];
  base: { lat: number; lng: number } | null; baseSet: boolean; totalKm: number; mapsUrl: string | null; stops: DayStop[];
  counts: { visits: number; installs: number; tickets: number };
}

export interface Ratings {
  company: { average: number | null; count: number };
  people: { id: string; name: string; staffRole: StaffRole | null; average: number | null; count: number }[];
}

// power at home: load-shedding, UPS mode (a grid sensor), the bill from meter readings
export interface CutWindow { from: string; to: string; days?: number[]; seen?: number; of?: number }
export interface NextCutInfo { at: string; until: string; now: boolean; text: string }
export type SheddingSource = 'typed' | 'learned' | 'area' | 'none';
export interface PowerStatus {
  timezone: string;
  grid: { sensor: boolean; off: boolean; since: string | null; sinceText: string | null; switchedOff: string[] };
  next: NextCutInfo | null;
  source: SheddingSource;
}
export interface Shedding {
  timezone: string; source: SheddingSource; windows: CutWindow[]; typed: CutWindow[]; next: NextCutInfo | null; text: string | null;
  learned: { source: SheddingSource; windows: CutWindow[]; observedDays: number; needed: number; cuts: number; place: string | null; slots: number[] };
}
export interface GridSettings {
  sensor: { id: string; name: string } | null; off: boolean; since: string | null; loads: string[]; restore: boolean; switchedOff: string[];
  switches: { id: string; name: string; room: string | null; heavy: boolean }[];
}
export interface Slab { upTo: number | null; rate: number }
export interface MeterReading { id: string; kwh: number; readAt: string; newMeter: boolean; by: string | null }
export interface Bill {
  timezone: string; billingDay: number; billingDayText: string;
  cycle: { start: string; end: string; daysIn: number; daysLeft: number };
  units: number; asOf: string; source: 'readings' | 'readings+estimate' | 'estimate' | 'none'; estimated: number;
  startReading: { kwh: number; at: string; exact: boolean } | null; latest: { kwh: number; readAt: string } | null;
  projected: number | null; tariff: number; tariffSet: boolean; slabs: Slab[];
  cost: { soFar: number; projected: number | null; lines: { units: number; rate: number; cost: number }[] };
  protectedLimit: number | null; over: boolean; heading: boolean;
  topDevices: { id: string; name: string; kwh: number }[]; lastMonth: number | null; message: string;
}

// time-limited access (people)
export interface AccessLimitsValue { accessUntil: string | null; accessFrom: string | null; accessTo: string | null; accessDays: number[] }
export type AccessLimitsInput = Partial<AccessLimitsValue>;

// who's home, and the last one out
export type PresenceStatus = 'home' | 'away' | 'unknown';
export interface WhoIsHome {
  sharing: boolean;
  people: { id: string; name: string; status: PresenceStatus; since: string | null; reportedAt: string | null; me: boolean }[];
  line: string | null;
  rule: { enabled: boolean; out: boolean; lastEvent: string | null; lastEventAt: string | null; lastResult: string | null } | null;
}
export interface PresenceRuleState {
  rule: {
    enabled: boolean; switchOff: 'none' | 'lights' | 'chosen'; offDevices: string[]; awayMode: boolean; notify: boolean;
    arriveSceneId: string | null; createdBy: string | null; createdById: string; out: boolean;
    lastEvent: 'left' | 'arrived' | null; lastEventAt: string | null; lastResult: string | null;
  } | null;
  devices: { id: string; name: string; type: string; room: string | null; lightOrFan: boolean }[];
  scenes: { id: string; name: string }[];
  sharers: number;
}
