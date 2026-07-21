// Response shapes for the super-admin API contract. Kept permissive (optional
// fields, string unions widened) so the console degrades gracefully if the
// backend shape drifts before both sides settle.

export type CallStatus = "healthy" | "stalling" | "bailing" | string;

export interface LiveCall {
  id: string;
  org: string;
  clone: string;
  prospect: string;
  dur: string;
  health: number; // 0-100
  status: CallStatus;
}
export interface Kpi { label: string; val: string; sub?: string; color?: string; }
export interface FleetResp { calls?: LiveCall[]; kpis?: Kpi[]; }

export interface Org {
  id: string;
  name: string;
  domain?: string;
  initials?: string;
  plan?: string;
  seats?: string;
  usage?: number; // percent of allowance
  margin?: string;
  health?: string;
  suspended?: boolean;
}
export interface OrgsResp { orgs?: Org[]; }

export interface UsageRow {
  id?: string;
  org: string;
  used?: string;
  cap?: string;
  pct?: number;
  margin?: string;
  profitable?: boolean;
}
export interface UsageResp {
  kpis?: Kpi[];
  rows?: UsageRow[];
  breakerEnabled?: boolean;
  breakerPct?: number;
  killSwitchEnabled?: boolean;
}

export interface ReadinessRow { id?: string; clone: string; org: string; score: number; }
export interface ReportRow {
  id: string;
  title: string;
  meta?: string;
  icon?: string;
  color?: string;
}

export interface RateCardItem { id: string; item: string; price: string; }
export interface BillingOrg { id: string; name: string; plan?: string; status?: string; mrrCents?: number; seats?: number; signupAt?: string | null; liveAt?: string | null; churnedAt?: string | null; }
export interface BillingResp { kpis?: Kpi[]; rateCard?: RateCardItem[]; orgs?: BillingOrg[]; }

export interface FeatureFlag { name: string; enabled: boolean; }
export interface ConfigResp {
  certThreshold?: number;
  modelTier?: string;
  authMode?: string;
  flags?: FeatureFlag[];
}

export interface AuditEntry {
  id?: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  icon?: string;
  color?: string;
  severity?: string;
}
export interface AuditResp { entries?: AuditEntry[]; }

// Reason-required confirm modal + the context every panel receives.
export interface ConfirmConfig {
  title: string;
  body: string;
  icon: string;
  danger: boolean;
  cta: string;
  run: (reason: string) => Promise<void> | void;
}
export interface PanelCtx {
  openConfirm: (c: ConfirmConfig) => void;
  toast: (msg: string, kind?: "ok" | "error") => void;
}
