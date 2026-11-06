// Types matching the API JSON (camelCase). null = no data, NOT 0.
export type Agg = { value: number | null; status: string; note: string; basis: string; nKnown: number; nTotal: number };
export type Ratio = { value: number | null; reason: string; nUsed: number; nTotal: number };
export type Kind = "int" | "vnd" | "pct" | "dec" | "x" | "compact";

export type Row = {
  code: string; platform: string; kind: string; title: string; url: string; campaign: string; sku: string; distribution: string;
  destination: string; aiGroup: string; attributionLevel: string; experiment: string; variant: string; trackingLink: string; kol: string;
  commissionRate: number | null; publishedAt: string | null; isDemo: boolean;
  views: Agg; impressions: Agg; engagements: Agg; comments: Agg; watchTimeSec: Agg; clicks: Agg; productViews: Agg; addToCart: Agg;
  exposure: Agg; orders: Agg; revenue: Agg; newCustomers: Agg; spend: Agg; totalCost: Agg; acqCost: Agg; productionCost: number | null;
  web: { sessions: number; product: number; clickShopee: number };
  ratios: { clickPerView: Ratio; orderPerClick: Ratio; ordersPer1000: Ratio; clicksPer1000: Ratio; roas: Ratio; costPerOrder: Ratio; cpc: Ratio };
};

export type Summary = {
  n: number;
  views: Agg; impressions: Agg; engagements: Agg; clicks: Agg; orders: Agg; revenue: Agg; cost: Agg; spend: Agg;
  clickPerView: Ratio; orderPerClick: Ratio; orderPerView: Ratio; clicksPer1000: Ratio; ordersPer1000: Ratio; ctrAd: Ratio; cpc: Ratio;
  roas: Ratio; costPerOrder: Ratio; cac: Ratio;
};

export type Step = { key: string; label: string; source: string; agg: Agg; rate: Ratio | null };
export type Product = {
  sku: string; name: string; price: number; flashPrice: number | null; stock: number | null; flavor: string; spiceLevel: string;
  shelfLife: string; shopeeUrl: string; source: string; isDemo: boolean; updatedAt: string | null;
};
export type Source = { key: string; name: string; platform: string | null; api: string; note: string; lastDate: string | null; nContents: number; daysOld: number | null };
export type Warning = { level: "info" | "warn"; text: string };
export type Filters = { from: string; to: string; platform: string; dist: string; campaign: string; sku: string; content: string; mode: string; nDays: number };

export type Meta = {
  enums: {
    platforms: Record<string, string>; kinds: Record<string, string>; distributions: Record<string, string>; destinations: Record<string, string>;
    aiGroups: Record<string, string>; levels: Record<string, string>; orderStatuses: Record<string, string>; costTypes: Record<string, string>;
    methods: Record<string, string>; modes: Record<string, string>; metricKeys: Record<string, string>; statusLabels: Record<string, string>;
  };
  counted: string[];
  targets: Record<string, { label: string; min?: number; max?: number; unit: string }>;
  metricDefs: { key: string; label: string; formula: string; scope: string; needs: string; unit: string }[];
  options: { campaigns: string[]; skus: { sku: string; name: string }[]; contents: { code: string; title: string }[] };
  counts: { demo: number; real: number };
};

export type Me = { user: string; csrf: string; defaultPassword: boolean };

export type Series = {
  days: string[]; views: Record<string, (number | null)[]>; clicks: Record<string, (number | null)[]>;
  cost: number[]; orders: number[]; revenue: number[];
};

export type Overview = {
  filters: Filters; nContents: number; summary: Summary;
  reach: { video: Agg; live: Agg; post: Agg; impressions: Agg };
  totals: { counted: number; revenue: number; notCounted: number; unattributed: number; reportedUnreconciled: number };
  web: { pageView: number; productView: number; clickShopee: number };
  series: Series;
  platforms: { key: string; label: string; n: number; summary: Summary | null }[];
  rank: { key: string; kind: Kind; label: string; options: { key: string; label: string }[]; top: { row: Row; value: Agg | Ratio }[]; bottom: { row: Row; value: Agg | Ratio }[] };
  sources: Source[]; warnings: Warning[];
};

export type FunnelData = {
  filters: Filters; path: "direct" | "website"; nAll: number; mixed: boolean; steps: Step[]; summary: Summary | null; rows: Row[];
  compare: { kind: string; content: string; label: string | null; steps: Step[] | null; summary: Summary | null };
};

export type LiveSession = {
  durationMin: number | null; questionsReceived: number | null; questionsAnswered: number | null; accuracyPct: number | null;
  avgDispatchMs: number | null; avgE2eMs: number | null; interventions: number | null; interruptions: number | null; costVnd: number | null;
};

export type AiData = {
  filters: Filters;
  chat: {
    n: number; sessions: number; resolved: Ratio; handoff: Ratio; accuracy: Ratio; reviewed: number; avgLatency: number | null; p95Latency: number | null;
    buy: Ratio; cost: number | null; costPerQuestion: number | null;
    byIntent: { intent: string; label: string; n: number; handoff: number; reviewed: number; correct: number; buy: number; handoffRate: Ratio; accuracy: Ratio }[];
  };
  lives: { row: Row; answerRate: Ratio; ordersPer1000: Ratio; session: LiveSession | null }[];
  videos: { row: Row; minutes: number | null; scriptVersion: string; productionCost: number | null }[];
  compare: { group: string; label: string; n: number; summary: Summary | null; avgMinutes: number | null; enough: boolean }[];
};

export type DataOverview = {
  sources: Source[];
  coverage: { platform: string; kind: string; n: number; cells: Record<string, { known: number; total: number; status: string } | null> }[];
  batches: { id: number; kind: string; filename: string; method: string; isDemo: boolean; rowsOk: number; rowsErr: number; sourceNote: string; createdAt: string | null }[];
  specs: { kind: string; label: string; columns: { name: string; type: string; required: boolean; help: string }[] }[];
  contentCodes: string[];
};

export type ImportResult = {
  kind: string; file: string; ok: number; errors: { row: number; message: string }[]; nErrors: number; warnings: string[];
  message: string; duplicate: boolean; rejected: boolean; batchId: number | null;
};
