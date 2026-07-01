import { type ReactNode, useEffect } from "react";
import { Icon } from "./Icon";
import { Button } from "./core";

// ---- EmptyState -----------------------------------------------------------
// Shown whenever a list/collection has no records yet. A clean, on-brand
// "nothing here" panel with an optional primary action (e.g. create / load).
export function EmptyState({
  icon = "inbox",
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: string;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 12,
        padding: compact ? "28px 20px" : "56px 24px",
        width: "100%",
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          color: "var(--jv-cyan)",
          background: "var(--grad-cyan-soft)",
          border: "1px solid var(--jv-border-cyan)",
          boxShadow: "inset 0 0 20px rgba(41,211,245,0.08)",
        }}
      >
        <Icon name={icon} size={24} />
      </span>
      <div style={{ font: "var(--fw-semibold) 15px var(--font-body)", color: "var(--jv-text)" }}>{title}</div>
      {hint && (
        <div style={{ maxWidth: 340, font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-muted)" }}>{hint}</div>
      )}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}

// ---- IconButton -----------------------------------------------------------
// Compact square icon-only affordance for row actions (delete, edit, etc.).
export function IconButton({
  icon,
  title,
  tone = "muted",
  onClick,
  size = 30,
}: {
  icon: string;
  title: string;
  tone?: "muted" | "danger" | "cyan";
  onClick?: (e: React.MouseEvent) => void;
  size?: number;
}) {
  const colors = {
    muted: { color: "var(--jv-text-muted)", border: "var(--jv-border-soft)", bg: "var(--jv-surface-3)" },
    danger: { color: "var(--jv-red-400)", border: "color-mix(in srgb, var(--jv-red-400) 34%, transparent)", bg: "color-mix(in srgb, var(--jv-red-400) 10%, transparent)" },
    cyan: { color: "var(--jv-cyan)", border: "var(--jv-border-cyan)", bg: "var(--grad-cyan-soft)" },
  }[tone];
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--r-sm)",
        cursor: "pointer",
        color: colors.color,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        transition: "filter var(--t-fast)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.25)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}

// ---- ConfirmDialog --------------------------------------------------------
// Modal confirmation for destructive/irreversible actions. Blocks until the
// operator chooses. `danger` styles the confirm button red.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        background: "rgba(2,8,16,0.66)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 92vw)",
          padding: 22,
          borderRadius: "var(--r-md)",
          background: "var(--jv-surface-2, #0c1a2e)",
          border: `1px solid ${danger ? "color-mix(in srgb, var(--jv-red-400) 40%, transparent)" : "var(--jv-border-cyan)"}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "50%", color: danger ? "var(--jv-red-400)" : "var(--jv-cyan)", background: danger ? "color-mix(in srgb, var(--jv-red-400) 12%, transparent)" : "var(--grad-cyan-soft)", border: `1px solid ${danger ? "color-mix(in srgb, var(--jv-red-400) 34%, transparent)" : "var(--jv-border-cyan)"}` }}>
            <Icon name={danger ? "alert-triangle" : "help-circle"} size={17} />
          </span>
          <div style={{ font: "var(--fw-bold) 15px var(--font-body)", color: "var(--jv-text)" }}>{title}</div>
        </div>
        {message && <div style={{ font: "var(--fw-regular) 13px/1.55 var(--font-body)", color: "var(--jv-text-soft)", marginBottom: 18 }}>{message}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} size="sm" onClick={onConfirm} disabled={busy} icon={busy ? <Icon name="loader" size={14} /> : undefined}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
