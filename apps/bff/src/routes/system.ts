import type { FastifyInstance } from "fastify";
import os from "node:os";
import { one } from "../db/pool.js";
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
  app.get("/api/system/ledger", async (): Promise<LedgerEntry[]> => {
    return (await one<{ value: LedgerEntry[] }>(`SELECT value FROM settings WHERE key = 'ledger'`))?.value ?? [];
  });

  app.get("/api/system/slow-turns", async (): Promise<{ floor: string; turns: SlowTurn[] }> => {
    return (
      (await one<{ value: { floor: string; turns: SlowTurn[] } }>(`SELECT value FROM settings WHERE key = 'slow_turns'`))?.value ?? {
        floor: "",
        turns: [],
      }
    );
  });

  app.get("/api/system/logs", async (): Promise<LogEntry[]> => {
    return (await one<{ value: LogEntry[] }>(`SELECT value FROM settings WHERE key = 'logs'`))?.value ?? [];
  });

  // Consolidated health for status strips (Command Center + top bar).
  app.get("/api/system/health", async (): Promise<SystemHealth> => {
    const reachable = await hermesReachable();
    const vector = (await one<{ value: any }>(`SELECT value FROM settings WHERE key = 'vector_store'`))?.value ?? { items: 0 };
    const strip: StatusStripItem[] = [
      { icon: "cpu", name: "AI Core", status: reachable ? "Active" : "Offline", tone: reachable ? "optimal" : "warn" },
      { icon: "database", name: "Memory", status: Number(vector.items).toLocaleString(), tone: "info" },
      { icon: "mic", name: "Voice", status: "Online", tone: "optimal" },
      { icon: "bot", name: "Agents", status: "2 Running", tone: "standby" },
      { icon: "boxes", name: "LLMs", status: reachable ? "Connected" : "Check", tone: reachable ? "optimal" : "warn" },
      { icon: "shield-check", name: "System", status: "Optimal", tone: "optimal" },
    ];
    return { strip, gauges: hostGauges(40), online: true, hermesReachable: reachable };
  });
}
