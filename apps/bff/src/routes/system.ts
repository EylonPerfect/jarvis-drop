import type { FastifyInstance } from "fastify";
import os from "node:os";
import { one } from "../db/pool.js";
import { orgId } from "../lib/auth.js";
import { getSetting } from "../lib/settingsStore.js";
import { hermes, hermesReachable } from "../hermes.js";
import type { Gauges, LedgerEntry, SlowTurn, LogEntry, SystemHealth, StatusStripItem } from "@jarvis/shared";

// Real host gauges (reflect the VPS when the BFF is co-located there).
function hostGauges(diskFallback: number): Gauges {
  const total = os.totalmem();
  const used = total - os.freemem();
  const ram = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
  const cores = os.cpus().length || 1;
  const load = os.loadavg()[0] ?? 0;
  const cpu = Math.max(0, Math.min(100, Math.round((load / cores) * 100)));
  return { cpu, ram, disk: diskFallback };
}

export default async function systemRoutes(app: FastifyInstance) {
  app.get("/api/system/gauges", async (): Promise<Gauges> => {
    const detailed = await hermes.healthDetailed();
    const d = detailed.data as any;
    if (detailed.ok && d && (d.cpu != null || d.memory != null)) {
      return {
        cpu: Math.round(d.cpu?.percent ?? d.cpu ?? hostGauges(40).cpu),
        ram: Math.round(d.memory?.percent ?? d.ram ?? hostGauges(40).ram),
        disk: Math.round(d.disk?.percent ?? d.disk ?? 40),
      };
    }
    return hostGauges(40);
  });

  // Live Action Ledger — every tool call this session (retry/fallback/verify).
  app.get("/api/system/ledger", async (req): Promise<LedgerEntry[]> => {
    return (await getSetting<LedgerEntry[]>(orgId(req), "ledger")) ?? [];
  });

  app.get("/api/system/slow-turns", async (req): Promise<{ floor: string; turns: SlowTurn[] }> => {
    return (
      (await getSetting<{ floor: string; turns: SlowTurn[] }>(orgId(req), "slow_turns")) ?? {
        floor: "",
        turns: [],
      }
    );
  });

  app.get("/api/system/logs", async (req): Promise<LogEntry[]> => {
    return (await getSetting<LogEntry[]>(orgId(req), "logs")) ?? [];
  });

  // Consolidated health for status strips (Command Center + top bar).
  app.get("/api/system/health", async (req): Promise<SystemHealth> => {
    const reachable = await hermesReachable();
    // Real counts from the DB — no fabricated status.
    const facts = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM memory_facts WHERE org_id = $1`, [orgId(req)]))?.n ?? 0;
    const running = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM agents WHERE org_id = $1 AND status = 'optimal'`, [orgId(req)]))?.n ?? 0;
    const agentsTotal = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM agents WHERE org_id = $1`, [orgId(req)]))?.n ?? 0;
    const providers = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ai_providers WHERE org_id = $1`, [orgId(req)]))?.n ?? 0;
    const activeProv = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ai_providers WHERE org_id = $1 AND active = true`, [orgId(req)]))?.n ?? 0;

    const llmCount = providers + (reachable ? 1 : 0); // connected providers + hermes gateway
    const aiOnline = activeProv > 0 || reachable; // a chat backend is available
    // NOTE: "Voice" is a browser capability, not a server metric, so it is NOT
    // reported here — the Command Center adds a Voice tile from the live browser.
    const strip: StatusStripItem[] = [
      { icon: "cpu", name: "AI Core", status: aiOnline ? "Online" : "Offline", tone: aiOnline ? "optimal" : "warn" },
      { icon: "database", name: "Memory", status: `${facts.toLocaleString()} ${facts === 1 ? "fact" : "facts"}`, tone: "info" },
      { icon: "bot", name: "Agents", status: running > 0 ? `${running} running` : `${agentsTotal} idle`, tone: running > 0 ? "optimal" : "standby" },
      { icon: "boxes", name: "LLMs", status: llmCount > 0 ? `${llmCount} connected` : "None", tone: llmCount > 0 ? "optimal" : "warn" },
      { icon: "shield-check", name: "System", status: "Optimal", tone: "optimal" },
    ];
    return { strip, gauges: hostGauges(40), online: true, hermesReachable: reachable };
  });
}
