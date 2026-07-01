import { useState } from "react";
import { Panel, Badge, Button, Icon, ConfirmDialog } from "../ds";
import { usePersistentState } from "../api/hooks";

type DiffRow = [string, string];

type QueueItem = {
  id: string;
  agent: string;
  ic: string;
  kind: string;
  clarifying?: boolean;
  irreversible?: boolean;
  escalated?: boolean;
  action: string;
  reason: string;
  rule: string;
  options?: string[];
  payload?: string[];
  diff?: DiffRow[];
};

const RULE_LABEL: Record<string, string> = { permission: "Permission wall", budget: "Budget cap", datawall: "Data wall", clarify: "Clarifying question" };
const KIND_VERB: Record<string, string> = { send: "Send", pay: "Pay", delete: "Delete", sign: "Sign", read: "Grant access" };

function ConfirmModal({ item, onClose, onConfirm }: { item: QueueItem; onClose: () => void; onConfirm: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(3,8,16,0.65)", backdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 500, maxWidth: "92%", borderRadius: "var(--r-lg)", background: "var(--grad-panel)", border: "1px solid color-mix(in srgb, var(--jv-red) 45%, transparent)", boxShadow: "var(--panel-shadow-active)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "16px 20px", borderBottom: "1px solid var(--jv-hairline)" }}>
          <span style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-red)", background: "color-mix(in srgb, var(--jv-red) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-red) 34%, transparent)" }}><Icon name="alert-triangle" size={19} /></span>
          <div>
            <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--jv-red)" }}>Irreversible — confirm to fire</div>
            <div style={{ font: "var(--fw-bold) 16px var(--font-body)", color: "var(--jv-text)", marginTop: 2 }}>{KIND_VERB[item.kind]} · {item.agent}</div>
          </div>
        </div>
        <div style={{ padding: "18px 20px" }}>
          <p style={{ margin: "0 0 14px", font: "var(--fw-medium) 13px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>{item.action}</p>
          <div style={{ font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 8 }}>What will happen</div>
          <div style={{ borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", overflow: "hidden" }}>
            {item.diff!.map(([sign, text], i) => {
              const c = sign === "+" ? "var(--jv-green)" : sign === "-" ? "var(--jv-red)" : "var(--jv-text-muted)";
              return (
                <div key={i} style={{ display: "flex", gap: 10, padding: "9px 13px", borderBottom: i < item.diff!.length - 1 ? "1px solid var(--jv-hairline)" : "none", font: "12px/1.4 var(--font-mono)" }}>
                  <span style={{ color: c, fontWeight: 700, width: 10 }}>{sign}</span><span style={{ color: "var(--jv-text-soft)" }}>{text}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--jv-hairline)" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <button onClick={onConfirm} style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 18px", height: 40, borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-red) 50%, transparent)", background: "color-mix(in srgb, var(--jv-red) 18%, transparent)", color: "#ffd7dc", font: "var(--fw-semibold) 12px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", boxShadow: "0 0 18px color-mix(in srgb, var(--jv-red) 40%, transparent)" }}><Icon name="zap" size={14} />Confirm &amp; fire</button>
        </div>
      </div>
    </div>
  );
}

function ApprovalItem({ item, onResolve }: { item: QueueItem; onResolve: (id: string, verb: string) => void }) {
  const [sim, setSim] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reply, setReply] = useState("");
  if (item.kind === "question") {
    return (
      <div style={{ borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: "1px solid var(--jv-border-cyan)", boxShadow: "0 0 18px rgba(41,211,245,0.08)", overflow: "hidden" }}>
        <div style={{ padding: "15px 16px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
            <span style={{ width: 40, height: 40, flex: "0 0 40px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}><Icon name="help-circle" size={19} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <span style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-cyan-300)" }}>{item.agent}</span>
                <span style={{ padding: "2px 7px", borderRadius: 3, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)" }}>Asking you</span>
              </div>
              <div style={{ font: "var(--fw-medium) 13.5px/1.55 var(--font-body)", color: "var(--jv-text)" }}>{item.action}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {item.options!.map((o) => (
                  <button key={o} onClick={() => onResolve(item.id, "answered")} style={{ padding: "8px 14px", borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border-cyan)", background: "var(--grad-cyan-soft)", color: "var(--jv-cyan-300)", font: "var(--fw-semibold) 12px var(--font-body)", cursor: "pointer" }}>{o}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reply.trim() && onResolve(item.id, "answered")} placeholder="…or type your own answer" style={{ flex: 1, height: 38, padding: "0 13px", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", color: "var(--jv-text)", font: "var(--fw-medium) 13px var(--font-body)", outline: "none" }} />
                <button onClick={() => reply.trim() && onResolve(item.id, "answered")} style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", border: "none", background: reply.trim() ? "var(--jv-cyan)" : "var(--jv-surface-3)", color: reply.trim() ? "var(--accent-contrast)" : "var(--jv-text-muted)", cursor: "pointer" }}><Icon name="arrow-up" size={17} /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const approve = () => { if (item.irreversible) setConfirming(true); else onResolve(item.id, "approved"); };
  return (
    <div style={{ borderRadius: "var(--r-md)", background: "var(--jv-surface-2)", border: `1px solid ${item.escalated ? "color-mix(in srgb, var(--jv-amber) 40%, transparent)" : "var(--jv-border-soft)"}`, overflow: "hidden" }}>
      <div style={{ padding: "15px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
          <span style={{ width: 40, height: 40, flex: "0 0 40px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", color: "var(--jv-cyan)", background: "rgba(41,211,245,0.08)", border: "1px solid var(--jv-border-soft)" }}><Icon name={item.ic} size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ font: "var(--fw-bold) 13px var(--font-body)", color: "var(--jv-cyan-300)" }}>{item.agent}</span>
              {item.irreversible && <span style={{ padding: "2px 7px", borderRadius: 3, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-red)", background: "color-mix(in srgb, var(--jv-red) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-red) 32%, transparent)" }}>Irreversible</span>}
              {item.escalated && <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 3, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-amber)", background: "color-mix(in srgb, var(--jv-amber) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-amber) 32%, transparent)" }}><Icon name="alert-triangle" size={10} />Escalated</span>}
            </div>
            <div style={{ font: "var(--fw-medium) 13.5px/1.5 var(--font-body)", color: "var(--jv-text)" }}>{item.action}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, font: "var(--fw-medium) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>
              <Icon name="lock" size={12} color="var(--jv-amber)" /><span style={{ color: "var(--jv-amber)" }}>{RULE_LABEL[item.rule]}</span><span>· {item.reason}</span>
            </div>
          </div>
        </div>
        {/* payload preview */}
        <div style={{ marginTop: 12, marginLeft: 53, borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", padding: "10px 13px" }}>
          <div style={{ font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-text-faint)", marginBottom: 6 }}>Payload preview</div>
          {item.payload!.map((p, i) => <div key={i} style={{ font: "12px/1.6 var(--font-mono)", color: "var(--jv-text-soft)" }}>{p}</div>)}
        </div>
        {sim && (
          <div style={{ marginTop: 10, marginLeft: 53, borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--jv-cyan) 6%, transparent)", border: "1px solid var(--jv-border-cyan)", padding: "10px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-semibold) 9px var(--font-hud)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--jv-cyan-300)", marginBottom: 6 }}><Icon name="flask-conical" size={12} />Dry run — no changes made</div>
            {item.diff!.map(([sign, text], i) => {
              const c = sign === "+" ? "var(--jv-green)" : sign === "-" ? "var(--jv-red)" : "var(--jv-text-muted)";
              return <div key={i} style={{ font: "12px/1.5 var(--font-mono)", color: "var(--jv-text-soft)" }}><span style={{ color: c, fontWeight: 700 }}>{sign} </span>{text}</div>;
            })}
          </div>
        )}
      </div>
      {/* actions */}
      <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--jv-hairline)", background: "rgba(4,12,22,0.4)" }}>
        <button onClick={approve} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid color-mix(in srgb, var(--jv-green) 45%, transparent)", background: "color-mix(in srgb, var(--jv-green) 15%, transparent)", color: "#bff5df", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="check" size={14} />Approve</button>
        <button onClick={() => onResolve(item.id, "rejected")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", height: 34, borderRadius: "var(--r-sm)", border: "1px solid var(--jv-border)", background: "transparent", color: "var(--jv-text-soft)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="x" size={14} />Reject</button>
        <button onClick={() => setSim((s) => !s)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", height: 34, borderRadius: "var(--r-sm)", border: `1px solid ${sim ? "var(--jv-border-cyan)" : "var(--jv-border)"}`, background: sim ? "var(--grad-cyan-soft)" : "transparent", color: sim ? "var(--jv-cyan-300)" : "var(--jv-text-soft)", font: "var(--fw-semibold) 11px var(--font-hud)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}><Icon name="flask-conical" size={14} />Simulate</button>
      </div>
      {confirming && <ConfirmModal item={item} onClose={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onResolve(item.id, "approved"); }} />}
    </div>
  );
}

export default function ApprovalsInbox() {
  const [queue, setQueue] = usePersistentState<QueueItem[]>("approvals", []);
  const [toast, setToast] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const resolve = (id: string, verb: string) => { setQueue(queue.filter((x) => x.id !== id)); setToast(verb === "approved" ? "Action approved and fired." : verb === "answered" ? "Answer sent — agent resuming." : "Action rejected — agent notified."); setTimeout(() => setToast(null), 2200); };
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <Panel title="Approvals Inbox" eyebrow action={<div style={{ display: "flex", alignItems: "center", gap: 10 }}><Badge status={queue.length ? "warn" : "optimal"} solid>{queue.length} pending</Badge>{queue.length > 0 && <Button size="sm" variant="danger" icon={<Icon name="trash-2" size={13} />} onClick={() => setClearing(true)}>Clear all</Button>}</div>}>
        <p style={{ margin: "0 0 16px", font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>Actions your workforce cannot take without you. Each shows the agent, the action in plain language, why it stopped, and a payload preview. Irreversible actions confirm before firing.</p>
        {queue.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "56px 20px", textAlign: "center" }}>
            <span style={{ width: 60, height: 60, display: "grid", placeItems: "center", borderRadius: "50%", color: "var(--jv-green)", background: "color-mix(in srgb, var(--jv-green) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-green) 34%, transparent)", marginBottom: 16 }}><Icon name="check-check" size={28} /></span>
            <div style={{ font: "var(--fw-bold) 17px var(--font-body)", color: "var(--jv-text)" }}>Queue clear. Your workforce is running.</div>
            <div style={{ font: "var(--fw-regular) 13px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 6 }}>New requests that hit a permission or budget wall will land here.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {queue.map((item) => <ApprovalItem key={item.id} item={item} onResolve={resolve} />)}
          </div>
        )}
      </Panel>
      {toast && (
        <div style={{ position: "absolute", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 9, padding: "11px 18px", borderRadius: "var(--r-pill)", background: "var(--grad-panel)", border: "1px solid var(--jv-border-cyan)", boxShadow: "var(--panel-shadow-active)", font: "var(--fw-medium) 13px var(--font-body)", color: "var(--jv-text)" }}>
          <Icon name="info" size={15} color="var(--jv-cyan)" />{toast}
        </div>
      )}
      <ConfirmDialog open={clearing} danger title="Clear the approvals queue?" message="This removes every pending request from the inbox. Agents waiting on these decisions will be notified." confirmLabel="Clear all" onCancel={() => setClearing(false)} onConfirm={() => { setQueue([]); setClearing(false); setToast("Queue cleared."); setTimeout(() => setToast(null), 2200); }} />
    </div>
  );
}
