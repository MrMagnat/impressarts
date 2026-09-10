// Typed API client

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  if (res.status === 401) {
    throw new ApiError("unauthorized", 401);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
    } catch {}
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(msg: string, public status: number) {
    super(msg);
  }
}

// ---- types ----
export interface Meta {
  currentDate: string;
  currency: string;
  expiryWarnDays: number;
  snapshots: number;
  firstDate: string | null;
  lastDate: string | null;
  realDates: string[];
}

export interface TreeNode {
  level: "tip" | "vid" | "grp" | "position";
  key: string;
  label: string;
  tip: string;
  vid?: string;
  grp?: string;
  kg: number;
  money: number;
  positions: number;
  batches?: number;
  sharePct: number;
  hasChildren: boolean;
}
export interface TreeResp {
  parent: { level: string; label: string; kg: number; money: number };
  children: TreeNode[];
}

export interface Batch {
  series: string;
  kg: number;
  best_before: string | null;
  manufactured: string | null;
  manager: string | null;
  counterparty: string | null;
  money: number;
  days_left: number | null;
}
export interface DimAgg {
  value: string;
  kg: number;
  money: number;
  batches: number;
}
export interface ExpiryBucket {
  bucket: string;
  label: string;
  kg: number;
  money: number;
  batches: number;
}
export interface PositionCard {
  id: string;
  tip: string;
  vid: string;
  grp: string;
  name: string;
  price: number;
  kg: number;
  money: number;
  batchCount: number;
  batches: Batch[];
  managers: DimAgg[];
  counterparties: DimAgg[];
  history: { date: string; kg: number; money: number }[];
  expiry: ExpiryBucket[];
}

export interface Dashboard {
  currentDate: string;
  prevDate: string | null;
  totals: { kg: number; money: number; positions: number; batches: number };
  wow: { kgPct: number; moneyPct: number; kgAbs: number; moneyAbs: number };
  vsAvg: { kgPct: number; moneyPct: number };
  byTip: { tip: string; kg: number; money: number; positions: number }[];
  topVids: { tip: string; vid: string; kg: number; money: number }[];
  trend: { date: string; kg: number; money: number }[];
  expiry: ExpiryBucket[];
  topManagers: DimAgg[];
  topCounterparties: DimAgg[];
}

export interface Delta {
  abs: number;
  pct: number;
}
export interface ReportNode {
  key: string;
  label: string;
  kg: number;
  money: number;
  prevKg: number;
  prevMoney: number;
  avgMoney: number;
  vsPrev: { kg: Delta; money: Delta };
  vsAvg: { kg: Delta; money: Delta };
  vids?: ReportNode[];
}
export interface Mover {
  name: string;
  tip: string;
  vid: string;
  curMoney: number;
  prevMoney: number;
  curKg: number;
  prevKg: number;
  diff: number;
  diffPct: number;
}
export interface Report {
  kind: "weekly" | "monthly";
  date: string;
  month?: string;
  prevDate: string | null;
  prevMonth?: string | null;
  avgWeeks?: number;
  avgMonths?: number;
  totals: {
    kg: number;
    money: number;
    prevKg: number;
    prevMoney: number;
    avgKg: number;
    avgMoney: number;
    vsPrev: { kg: Delta; money: Delta };
    vsAvg: { kg: Delta; money: Delta };
  };
  tips: ReportNode[];
  movers: { grew: Mover[]; fell: Mover[] };
}

export interface Break {
  value: string;
  money: number;
  kg: number;
  sharePct: number;
}
export interface ScopeChild {
  key: string;
  label: string;
  level: string;
  money: number;
  kg: number;
  prevMoney: number;
  avgMoney: number;
  vsPrev: { money: Delta; kg: Delta };
  vsAvg: { money: Delta; kg: Delta };
  sharePct: number;
  hasChildren: boolean;
}
export interface ScopeReport {
  kind: "weekly" | "monthly";
  scope: { tip?: string; vid?: string; grp?: string };
  label: string;
  childLabel: string | null;
  target: string;
  targetMonth?: string;
  prevDate: string | null;
  avgCount: number;
  totals: {
    money: number;
    kg: number;
    prevMoney: number;
    avgMoney: number;
    vsPrev: { money: Delta; kg: Delta };
    vsAvg: { money: Delta; kg: Delta };
  };
  children: ScopeChild[];
  history: { date: string; month?: string; money: number; kg: number }[];
  movers: { grew: Mover[]; fell: Mover[] };
}

export interface Competitive {
  dim: "manager" | "counterparty" | "subcategory";
  scope: any;
  childLabel: string | null;
  cur: string;
  prevDate: string | null;
  avgCount: number;
  now: Break[];
  prev: Break[];
  avg: Break[];
  seriesValues: string[];
  series: Record<string, { date: string; money: number; kg: number }[]>;
  scopeHistory: { date: string; money: number; kg: number }[];
}

export interface PriceRow {
  vid: string;
  price: number;
  kg: number;
  money: number;
  tip: string;
}
export interface GeneralSettings {
  currency: string;
  expiryWarnDays: number;
  currentDate: string;
  passwordSet: boolean;
  uploads: string[];
}

// ---- endpoints ----
export interface LicenseState {
  locked: boolean;
  reason: string;
  customer: string | null;
  exp: number | null;
  expiresIn: number | null;
  lastCheck: number | null;
}


// ---- источник 1С ----
export interface ScheduleState {
  enabled: boolean;
  hour: number;
  mode: "compare" | "import";
  lastRunDate: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
  running: boolean;
}
export interface SourceConfig {
  url: string;
  login: string;
  passwordSet: boolean;
  enabled: boolean;
  mode: "compare" | "import";
  hour: number;
  timeoutSec: number;
  retentionDays: number;
  schedule: ScheduleState;
  exampleUrl: string;
}
export interface SyncLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  mode: string;
  ask_date: string | null;
  url: string | null;
  http_status: number | null;
  duration_ms: number | null;
  status: "ok" | "diff" | "imported" | "error";
  rows: number | null;
  positions: number | null;
  new_positions: number | null;
  gone_positions: number | null;
  changed_positions: number | null;
  src_kg: number | null;
  src_money: number | null;
  db_kg: number | null;
  db_money: number | null;
  message: string | null;
  sample: string | null;
}
export interface SyncResult {
  id: number;
  status: "ok" | "diff" | "imported" | "error";
  askDate: string;
  snapshotDate: string | null;
  url: string;
  httpStatus: number;
  durationMs: number;
  rows: number;
  positions: number;
  newPositions: string[];
  gonePositions: string[];
  changedPositions: number;
  src: { kg: number; money: number };
  dbBefore: { kg: number; money: number };
  message: string;
  sample: string;
  diag?: { format: string; mappedColumns: Record<string, string>; unmapped: string[]; skipped: number };
}
export interface SourceProbe {
  url: string;
  ok: boolean;
  httpStatus: number;
  contentType: string;
  bytes: number;
  durationMs: number;
  error: string | null;
  bodyHead: string;
  parsed: { snapshotDate: string; rows: number; diag: any; firstRows: any[] } | null;
  parseError: string | null;
}
export interface StorageStats {
  factRows: number;
  aggRows: number;
  batchRows: number;
  positions: number;
  detailDates: number;
  aggDates: number;
  currentDate: string;
  firstDate: string | null;
  lastDate: string | null;
  months: number;
  dbBytes: number;
  retentionDays: number;
}
export interface BackfillResult {
  requested: string[];
  loaded: string[];
  failed: { date: string; error: string }[];
  skipped: string[];
}

export const api = {
  licenseStatus: () => req<LicenseState>("/api/license/status"),

  login: (password: string) =>
    req<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => req<{ authenticated: boolean }>("/api/auth/me"),

  meta: () => req<Meta>("/api/meta"),
  tree: (p: { tip?: string; vid?: string; grp?: string }) => {
    const q = new URLSearchParams();
    if (p.tip) q.set("tip", p.tip);
    if (p.vid) q.set("vid", p.vid);
    if (p.grp !== undefined) q.set("grp", p.grp);
    return req<TreeResp>("/api/catalog/tree?" + q.toString());
  },
  position: (id: string) => req<PositionCard>("/api/catalog/position/" + encodeURIComponent(id)),
  search: (q: string) => req<any[]>("/api/catalog/search?q=" + encodeURIComponent(q)),

  dashboard: () => req<Dashboard>("/api/dashboard"),

  weeks: () => req<string[]>("/api/reports/weeks"),
  months: () => req<{ month: string; date: string }[]>("/api/reports/months"),
  weekly: (date?: string) => req<Report>("/api/reports/weekly" + (date ? "?date=" + date : "")),
  monthly: (month?: string) =>
    req<Report>("/api/reports/monthly" + (month ? "?month=" + month : "")),
  scopeReport: (p: {
    tip?: string;
    vid?: string;
    grp?: string;
    kind: "weekly" | "monthly";
    period?: string;
  }) => {
    const q = new URLSearchParams();
    q.set("kind", p.kind);
    if (p.tip) q.set("tip", p.tip);
    if (p.vid) q.set("vid", p.vid);
    if (p.grp) q.set("grp", p.grp);
    if (p.period) q.set("period", p.period);
    return req<ScopeReport>("/api/reports/scope?" + q.toString());
  },
  competitive: (p: {
    type: "position" | "category";
    id?: string;
    tip?: string;
    vid?: string;
    grp?: string;
    dim: "manager" | "counterparty" | "subcategory";
  }) => {
    const q = new URLSearchParams();
    q.set("type", p.type);
    q.set("dim", p.dim);
    if (p.id) q.set("id", p.id);
    if (p.tip) q.set("tip", p.tip);
    if (p.vid) q.set("vid", p.vid);
    if (p.grp) q.set("grp", p.grp);
    return req<Competitive>("/api/reports/competitive?" + q.toString());
  },
  pdfUrl: (kind: "weekly" | "monthly", key?: string) =>
    `/api/reports/${kind}.pdf` + (key ? `?${kind === "weekly" ? "date" : "month"}=${key}` : ""),
  scopePdfUrl: (p: { tip?: string; vid?: string; grp?: string }) => {
    const q = new URLSearchParams();
    if (p.tip) q.set("tip", p.tip);
    if (p.vid) q.set("vid", p.vid);
    if (p.grp) q.set("grp", p.grp);
    return "/api/reports/scope.pdf?" + q.toString();
  },
  positionPdfUrl: (id: string) => "/api/reports/position.pdf?id=" + encodeURIComponent(id),

  prices: () => req<PriceRow[]>("/api/settings/prices"),
  savePrices: (prices: { vid: string; price: number }[]) =>
    req<{ ok: boolean }>("/api/settings/prices", {
      method: "PUT",
      body: JSON.stringify({ prices }),
    }),
  general: () => req<GeneralSettings>("/api/settings/general"),
  saveGeneral: (b: Partial<{ currency: string; expiryWarnDays: number; password: string }>) =>
    req<{ ok: boolean }>("/api/settings/general", { method: "PUT", body: JSON.stringify(b) }),

  // источник 1С
  sourceConfig: () => req<SourceConfig>("/api/source/config"),
  saveSourceConfig: (b: Partial<Omit<SourceConfig, "schedule" | "exampleUrl" | "passwordSet">> & { password?: string | null }) =>
    req<{ ok: boolean; exampleUrl: string; schedule: ScheduleState }>("/api/source/config", {
      method: "PUT",
      body: JSON.stringify(b),
    }),
  sourceCheck: (b: { date?: string; mode?: "compare" | "import" } = {}) =>
    req<SyncResult>("/api/source/check", { method: "POST", body: JSON.stringify(b) }),
  sourceProbe: (date?: string) =>
    req<SourceProbe>("/api/source/probe" + (date ? "?date=" + date : "")),
  sourceLog: (limit = 50) => req<SyncLogRow[]>("/api/source/log?limit=" + limit),

  // хранение истории
  storageStats: () => req<StorageStats>("/api/storage/stats"),
  storageCompact: (retentionDays?: number) =>
    req<{ ok: boolean; cutoff: string; aggregated: string[]; factRowsDeleted: number; batchRowsDeleted: number; stats: StorageStats }>(
      "/api/storage/compact",
      { method: "POST", body: JSON.stringify({ retentionDays }) },
    ),
  storageBackfill: (b: { from: string; to: string; step?: "day" | "week" | "month"; maxPoints?: number }) =>
    req<BackfillResult>("/api/storage/backfill", { method: "POST", body: JSON.stringify(b) }),
};
