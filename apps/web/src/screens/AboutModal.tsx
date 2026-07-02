import { type ReactNode, useState } from "react";
import { Icon, Logo, Button } from "../ds";

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
          <Logo size={70} />
          <div style={{ font: "var(--fw-bold) 26px var(--font-display)", letterSpacing: "0.14em", color: "var(--jv-cyan-300)", textShadow: "var(--glow-cyan)", marginTop: 14 }}>
            J.A.R.V.I.S.
          </div>
          <div style={{ font: "var(--fw-regular) 12px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 6 }}>Just A Rather Very Intelligent System</div>
          <div style={{ display: "flex", gap: 7, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
            {["v3.0.0", "win32 x64", "Electron 33.4.11", "Node 20.18.3"].map((c) => (
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
                A
              </span>
              <div>
                <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>Adrees Umer</div>
                <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Solo developer — design, engineering &amp; everything in between</div>
              </div>
            </div>
            <p style={{ margin: "0 0 14px", font: "var(--fw-regular) 12px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>
              J.A.R.V.I.S. is independently designed, built and maintained by a single developer. Feedback, ideas and bug reports go straight to the person who writes the code — say hello!
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <LinkRow ic="box" label="Portfolio" href="https://adreesumer.com" external />
              <LinkRow ic="linkedin" label="LinkedIn" href="https://www.linkedin.com/in/adrees-umer" external />
              <LinkRow ic="globe" label="jarvis.adreesumer.com" href="https://jarvis.adreesumer.com" external />
              <LinkRow ic="mail" label="Email me" href="mailto:adrees4234@gmail.com" />
            </div>
            <div style={{ marginTop: 8 }}>
              <LinkRow ic="message-circle" label="Follow the Jarvis AI Assistant channel on WhatsApp" sub="Updates, tips &amp; release news" href="https://whatsapp.com/channel" external />
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
              <span style={{ font: "12px var(--font-mono)", color: "var(--jv-text-soft)" }}>adrees4234@gmail.com</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText("adrees4234@gmail.com").catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-faint)", marginTop: 16 }}>© 2026 Adrees Umer · Built with passion, one commit at a time.</div>
        </div>
      </div>
    </div>
  );
}
