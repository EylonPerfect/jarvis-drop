import { useState } from "react";
import { Panel, Button, Icon } from "../ds";
import { api } from "../api/client";

// Dev/admin control: wipe or re-seed the app database, then reload so every
// screen refetches. Two-step confirm to avoid accidental data loss.
export default function AdminReset() {
  const [pending, setPending] = useState<"clear" | "seed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (mode: "clear" | "seed") => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post("/api/admin/reset", { mode });
      setMsg(mode === "clear" ? "Database cleared — reloading…" : "Demo data restored — reloading…");
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setMsg(`Failed: ${String(e)}`);
      setBusy(false);
      setPending(null);
    }
  };

  const btn = (mode: "clear" | "seed", label: string, danger: boolean) => {
    const confirming = pending === mode;
    return (
      <Button
        variant={danger ? "danger" : "secondary"}
        size="sm"
        disabled={busy}
        icon={<Icon name={mode === "clear" ? "trash-2" : "refresh-cw"} size={14} />}
        onClick={() => (confirming ? run(mode) : (setPending(mode), setMsg(null)))}
      >
        {confirming ? "Click again to confirm" : label}
      </Button>
    );
  };

  return (
    <Panel
      title="Data — Danger Zone"
      eyebrow
      action={
        pending ? (
          <button
            onClick={() => setPending(null)}
            style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", font: "var(--fw-medium) 12px var(--font-body)" }}
          >
            Cancel
          </button>
        ) : null
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220, font: "var(--fw-regular) 12.5px/1.5 var(--font-body)", color: "var(--jv-text-muted)" }}>
          Reset the app database so you can build and check features from a clean slate. This affects the app's Postgres data (agents, tasks, calendar, knowledge base, costs) — it does not touch hermes.
        </div>
        {btn("clear", "Clear all data", true)}
        {btn("seed", "Reset to demo data", false)}
      </div>
      {msg && (
        <div style={{ marginTop: 12, font: "12px var(--font-mono)", color: msg.startsWith("Failed") ? "var(--jv-red)" : "var(--jv-green)" }}>{msg}</div>
      )}
    </Panel>
  );
}
