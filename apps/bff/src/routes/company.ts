import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { one, query } from "../db/pool.js";
import type { Person, NewPerson, OrgNode } from "@jarvis/shared";

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

  // ---- People (the HUMANS in the company) ----
  const rowToPerson = (r: any): Person => ({
    id: r.id,
    name: r.name,
    title: r.title ?? undefined,
    email: r.email ?? undefined,
    department: r.department ?? undefined,
    reportsToId: r.reports_to_id ?? null,
    isYou: !!r.is_you,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  });

  app.get("/api/company/people", async () => {
    const rows = await query(`SELECT * FROM company_people ORDER BY created_at`);
    return rows.map(rowToPerson);
  });

  app.post("/api/company/people", async (req, reply) => {
    const b = (req.body as NewPerson) ?? ({} as NewPerson);
    if (!b?.name?.trim()) return reply.code(400).send({ error: "name is required" });
    const id = `p_${randomUUID()}`;
    await query(
      `INSERT INTO company_people (id, name, title, email, department, reports_to_id, is_you, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        b.name.trim().slice(0, 120),
        b.title?.toString().slice(0, 160) ?? null,
        b.email?.toString().slice(0, 200) ?? null,
        b.department?.toString().slice(0, 160) ?? null,
        b.reportsToId ?? null,
        b.isYou ?? false,
        b.notes?.toString().slice(0, 800) ?? null,
      ],
    );
    const row = await one(`SELECT * FROM company_people WHERE id = $1`, [id]);
    return reply.code(201).send(rowToPerson(row));
  });

  app.put("/api/company/people/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body as Partial<NewPerson>) ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = $${sets.length + 1}`);
      vals.push(v);
    };
    if (b.name !== undefined) set("name", b.name.toString().slice(0, 120));
    if (b.title !== undefined) set("title", b.title === null ? null : b.title.toString().slice(0, 160));
    if (b.email !== undefined) set("email", b.email === null ? null : b.email.toString().slice(0, 200));
    if (b.department !== undefined) set("department", b.department === null ? null : b.department.toString().slice(0, 160));
    if (b.reportsToId !== undefined) set("reports_to_id", b.reportsToId ?? null);
    if (b.isYou !== undefined) set("is_you", !!b.isYou);
    if (b.notes !== undefined) set("notes", b.notes === null ? null : b.notes.toString().slice(0, 800));
    if (!sets.length) return reply.code(400).send({ error: "no fields to update" });
    vals.push(id);
    await query(`UPDATE company_people SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    const row = await one(`SELECT * FROM company_people WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: "not found" });
    return rowToPerson(row);
  });

  app.delete("/api/company/people/:id", async (req) => {
    const { id } = req.params as { id: string };
    // Keep the tree valid: anyone who reported to this person becomes a root.
    await query(`UPDATE company_people SET reports_to_id = NULL WHERE reports_to_id = $1`, [id]);
    await query(`DELETE FROM company_people WHERE id = $1`, [id]);
    return { ok: true };
  });

  // ---- Org chart (humans + AI agents) ----
  // Builds a forest of people (children = those whose reports_to_id === this id),
  // then attaches each AGENT under the person it reports to (matched by email,
  // then name, case-insensitive). Unmatched agents become additional roots.
  app.get("/api/company/org", async (): Promise<OrgNode[]> => {
    const people = (await query(`SELECT * FROM company_people ORDER BY created_at`)).map(rowToPerson);

    // Person nodes keyed by id.
    const nodes = new Map<string, OrgNode>();
    for (const p of people) {
      nodes.set(p.id, {
        id: p.id,
        kind: "person",
        name: p.name,
        title: p.title,
        email: p.email,
        department: p.department,
        reportsToId: p.reportsToId ?? null,
        icon: "user-round",
        children: [],
      });
    }

    // Wire humans to their manager, guarding against cycles and dangling refs.
    const roots: OrgNode[] = [];
    for (const p of people) {
      const node = nodes.get(p.id)!;
      const parentId = p.reportsToId;
      let attached = false;
      if (parentId && parentId !== p.id && nodes.has(parentId)) {
        // Walk up from the prospective parent; if we reach this node, it's a cycle.
        let cur: string | null | undefined = parentId;
        let cyclic = false;
        const seen = new Set<string>();
        while (cur) {
          if (cur === p.id) { cyclic = true; break; }
          if (seen.has(cur)) break;
          seen.add(cur);
          cur = nodes.get(cur)?.reportsToId ?? null;
        }
        if (!cyclic) {
          nodes.get(parentId)!.children.push(node);
          attached = true;
        }
      }
      if (!attached) roots.push(node);
    }

    // Attach agents. Match onboarding.reportsTo {email,name} to a person.
    const agents = await query<{ id: string; icon: string; name: string; role: string; onboarding: any }>(
      `SELECT id, icon, name, role, onboarding FROM agents ORDER BY sort, created_at`,
    );
    const byEmail = new Map<string, OrgNode>();
    const byName = new Map<string, OrgNode>();
    for (const p of people) {
      const node = nodes.get(p.id)!;
      if (p.email) byEmail.set(p.email.trim().toLowerCase(), node);
      if (p.name) byName.set(p.name.trim().toLowerCase(), node);
    }
    for (const a of agents) {
      const ob = a.onboarding && typeof a.onboarding === "object" ? a.onboarding : {};
      const rt = ob.reportsTo && typeof ob.reportsTo === "object" ? ob.reportsTo : {};
      const email = typeof rt.email === "string" ? rt.email.trim().toLowerCase() : "";
      const name = typeof rt.name === "string" ? rt.name.trim().toLowerCase() : "";
      const parent = (email && byEmail.get(email)) || (name && byName.get(name)) || null;
      const agentNode: OrgNode = {
        id: a.id,
        kind: "agent",
        name: a.name,
        title: a.role ?? undefined,
        reportsToId: parent ? parent.id : null,
        icon: a.icon || "bot",
        children: [],
      };
      if (parent) parent.children.push(agentNode);
      else roots.push(agentNode);
    }

    return roots;
  });
}
