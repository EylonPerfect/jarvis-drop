// AICore — the AI Control Center: connect provider keys, choose the active model,
// keep expert routing controls available. Ported from the prototype screen and
// wired to the /api/aicore backend endpoint.
import { useEffect, useState } from "react";
import { Panel, Badge, Button, Switch, Icon, EmptyState } from "../ds";
import type { AICoreState, ProviderKey } from "@jarvis/shared";
import { useApi } from "../api/hooks";
import { api } from "../api/client";

// Zeroed fallback for a clean, unconfigured install. No fabricated models,
// providers, or key counts — everything reads as empty until the BFF returns
// real configuration.
const EMPTY: AICoreState = {
  activeModel: "None",
  connectedProviders: "0 connected",
  fallbacks: "—",
  savedKeys: "0",
  routing: false,
  streaming: false,
  verification: false,
  models: [],
  providers: [],
};

function MetaTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-soft)" }}>
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}><Icon name={icon} size={16} /></span>
      <div>
        <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{label}</div>
        <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)", marginTop: 3 }}>{value}</div>
      </div>
    </div>
  );
}

function ProviderCard({ p, value, onChange, mono = true }: { p: ProviderKey; value: string; onChange: (v: string) => void; mono?: boolean }) {
  const [show, setShow] = useState(false);
  const filled = p.connected;
  const tierC = ({ free: "var(--jv-green)", paid: "var(--jv-violet)", "free tier": "var(--jv-green)" } as Record<string, string>)[p.tierTone] || "var(--jv-cyan)";
  return (
    <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${filled ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{p.name}</span>
          <span style={{ padding: "2px 7px", borderRadius: 3, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: tierC, background: `color-mix(in srgb, ${tierC} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${tierC} 34%, transparent)` }}>{p.tier}</span>
        </div>
        {filled && <span style={{ display: "flex", alignItems: "center", gap: 4, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-green)" }}><Icon name="check" size={12} /> Connected</span>}
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input value={value} onChange={(e) => onChange(e.target.value)} type={show ? "text" : "password"} placeholder={p.placeholder}
          style={{ width: "100%", height: 40, padding: "0 40px 0 14px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: `var(--fw-medium) 13px ${mono ? "var(--font-mono)" : "var(--font-body)"}`, outline: "none", boxSizing: "border-box" }} />
        <button onClick={() => setShow((s) => !s)} style={{ position: "absolute", right: 10, background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name={show ? "eye-off" : "eye"} size={16} /></button>
      </div>
      <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)" }}>Paste a key here to connect this provider to Jarvis.</div>
    </div>
  );
}

export default function AICore() {
  const { data, reload } = useApi<AICoreState>("/api/aicore");
  const state = data ?? EMPTY;

  const [routing, setRouting] = useState(state.routing);
  const [stream, setStream] = useState(state.streaming);
  const [verify, setVerify] = useState(state.verification);
  // Draft provider keys keyed by provider id, until "Save provider keys" persists them.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // useState initializers capture the EMPTY values on first render; resync the
  // switches once the real config arrives from the BFF.
  useEffect(() => {
    if (data) {
      setRouting(data.routing);
      setStream(data.streaming);
      setVerify(data.verification);
    }
  }, [data]);

  // Persist any typed provider keys to the BFF, then reload to reflect the new
  // connected state and available models.
  const saveKeys = async () => {
    const pending = Object.entries(keys).filter(([, v]) => v.trim());
    if (pending.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(pending.map(([id, key]) => api.patch(`/api/aicore/providers/${id}`, { key: key.trim(), connected: true })));
      setKeys({});
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* hero */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
        <Panel>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <Badge status="optimal">Ready for chat</Badge>
            <Badge status="info" dot={false}><Icon name="shield" size={11} style={{ marginRight: 4 }} />guarded privacy</Badge>
          </div>
          <div style={{ font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>AI Control Center</div>
          <p style={{ margin: "0 0 16px", maxWidth: 620, font: "var(--fw-regular) 13.5px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>Connect provider keys, choose the model Jarvis uses in chat, and keep expert routing controls available without making setup feel technical.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="primary" icon={<Icon name="refresh-cw" size={14} />} onClick={reload}>Refresh models</Button>
            <Button variant="ghost" icon={<Icon name="zap" size={14} />} onClick={() => window.open("https://console.groq.com/keys", "_blank", "noopener")}>Get free Groq key</Button>
          </div>
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MetaTile icon="cpu" label="Active model" value={state.activeModel} />
          <MetaTile icon="plug" label="Connected providers" value={state.connectedProviders} />
          <MetaTile icon="git-branch" label="Fallbacks" value={state.fallbacks} />
        </div>
      </div>

      {/* connect providers */}
      <Panel title="Connect AI providers" action={<Button size="sm" variant="secondary" icon={<Icon name="lock" size={13} />} onClick={saveKeys} disabled={saving || Object.values(keys).every((v) => !v.trim())}>Save provider keys</Button>}>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12px/1.55 var(--font-body)", color: "var(--jv-text-muted)", maxWidth: 640 }}>Add or update provider keys here. Jarvis stores them in your per-user configuration and refreshes available models immediately, so packaged Electron installs do not depend on .env files.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
          {([["Saved keys", state.savedKeys], ["Recommended start", "Groq free tier"], ["Storage", "Jarvis user config"]] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ padding: 14, borderRadius: "var(--r-md)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
              <div style={{ font: "var(--fw-medium) 10px var(--font-hud)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>{l}</div>
              <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)", marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
        {state.providers.length === 0 ? (
          <EmptyState icon="plug" title="No providers connected" hint="Connect a provider to give Jarvis a model to think with. Groq offers a free tier to get started." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {state.providers.map((p: ProviderKey) => (
              <ProviderCard key={p.id} p={p} value={keys[p.id] ?? ""} onChange={(v) => setKeys((k) => ({ ...k, [p.id]: v }))} />
            ))}
          </div>
        )}
      </Panel>

      {/* advanced */}
      <Panel title="Advanced settings" eyebrow>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {([
            ["Expert model routing", "Route each turn to the best-fit model automatically", routing, (val: boolean) => { setRouting(val); api.patch("/api/aicore", { routing: val }); }],
            ["Token streaming", "Stream responses token-by-token to the HUD", stream, (val: boolean) => { setStream(val); api.patch("/api/aicore", { streaming: val }); }],
            ["Response verification pass", "Run a second-model check on critical answers", verify, (val: boolean) => { setVerify(val); api.patch("/api/aicore", { verification: val }); }],
          ] as [string, string, boolean, (v: boolean) => void][]).map(([t, d, val, set], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: i < 2 ? "1px solid var(--jv-hairline)" : "none" }}>
              <div>
                <div style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{t}</div>
                <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{d}</div>
              </div>
              <Switch checked={val} onChange={set} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
