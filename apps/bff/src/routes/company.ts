import type { FastifyInstance } from "fastify";
import { one, query } from "../db/pool.js";

// The operator's company profile — set once, reused for every agent build so the
// AI discovery can tailor recommendations to who the company is (industry, size,
// core business). Stored in settings under 'company'.

export interface CompanyProfile {
  name: string;
  domain: string;
  industry: string;
  size: string;
  coreBusiness: string;
  notes?: string;
}

const DEFAULT_COMPANY: CompanyProfile = {
  name: "Go Perfect",
  domain: "goperfectmatch.com",
  industry: "AI recruiting / HR tech",
  size: "Startup",
  coreBusiness: "AI-native hiring platform — outbound sourcing, inbound screening, and autonomous candidate outreach",
  notes: "",
};

export async function getCompany(): Promise<CompanyProfile> {
  const row = await one<{ value: Partial<CompanyProfile> }>(`SELECT value FROM settings WHERE key = 'company'`);
  return { ...DEFAULT_COMPANY, ...(row?.value && typeof row.value === "object" ? row.value : {}) };
}

export default async function companyRoutes(app: FastifyInstance) {
  app.get("/api/company", async () => getCompany());

  app.put("/api/company", async (req) => {
    const b = (req.body as Partial<CompanyProfile>) ?? {};
    const cur = await getCompany();
    const next: CompanyProfile = {
      name: (b.name ?? cur.name).toString().slice(0, 120),
      domain: (b.domain ?? cur.domain).toString().slice(0, 200),
      industry: (b.industry ?? cur.industry).toString().slice(0, 200),
      size: (b.size ?? cur.size).toString().slice(0, 80),
      coreBusiness: (b.coreBusiness ?? cur.coreBusiness).toString().slice(0, 600),
      notes: (b.notes ?? cur.notes ?? "").toString().slice(0, 800),
    };
    await query(
      `INSERT INTO settings (key, value) VALUES ('company', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(next)],
    );
    return next;
  });
}
