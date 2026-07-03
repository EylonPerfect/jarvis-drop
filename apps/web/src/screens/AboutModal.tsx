import { type ReactNode, useState } from "react";
import { Icon, Button } from "../ds";

function LinkRow({ ic, label, sub, href, external }: { ic: string; label: string; sub?: string; href: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--r-sm)",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-soft)",
        textDecoration: "none",
      }}
    >
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)" }}>
        <Icon name={ic} size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-text)" }}>{label}</div>
        {sub && <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>{sub}</div>}
      </div>
    </a>
  );
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 50, display: "grid", placeItems: "start center", paddingTop: 60, background: "rgba(3,8,16,0.6)", backdropFilter: "blur(6px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxHeight: "82%",
          overflowY: "auto",
          borderRadius: "var(--r-lg)",
          background: "var(--grad-panel)",
          border: "1px solid var(--jv-border-cyan)",
          boxShadow: "var(--panel-shadow-active)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <span style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>About</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--jv-text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: "24px 24px 22px", textAlign: "center" }}>
          <img src="/after-human-logo.svg" alt="After Human — the workforce that comes next" style={{ width: 300, maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }} />
          <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 10 }}>Your always-on AI operator</div>
          <div style={{ display: "flex", gap: 7, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
            {["v3.0.0", "web", "Linux x64", "Hermes-connected"].map((c) => (
              <span
                key={c}
                style={{
                  padding: "3px 9px",
                  borderRadius: "var(--r-pill)",
                  font: "var(--fw-medium) 10px var(--font-mono)",
                  color: "var(--jv-text-soft)",
                  background: "var(--jv-surface-3)",
                  border: "1px solid var(--jv-border-soft)",
                }}
              >
                {c}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 20, padding: 16, borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-soft)", textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  background: "var(--grad-cyan-soft)",
                  border: "1px solid var(--jv-border-cyan)",
                  font: "var(--fw-bold) 16px var(--font-display)",
                  color: "var(--jv-cyan-300)",
                }}
              >
                E
              </span>
              <div>
                <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>Eylon</div>
                <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Operator · Go Perfect</div>
              </div>
            </div>
            <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>
              This is Eylon's private command center — a HUD for operating his deployed Hermes agent: chat, agents, tasks, memory, workflows and approvals in one place.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <LinkRow ic="globe" label="goperfectmatch.com" href="https://goperfectmatch.com" external />
              <LinkRow ic="mail" label="Email" href="mailto:eylon@goperfectmatch.com" />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: "var(--r-sm)",
                background: "var(--jv-void)",
                border: "1px solid var(--jv-border-soft)",
              }}
            >
              <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-soft)" }}>eylon@goperfectmatch.com</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText("eylon@goperfectmatch.com").catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 16 }}>© 2026 Eylon · After Human Command Center</div>
        </div>
      </div>
    </div>
  );
}
