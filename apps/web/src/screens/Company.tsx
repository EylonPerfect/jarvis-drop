// Company — the operator's onboarding + company profile screen. Three sections:
//   1. Company profile (set-once onboarding form, GET/PUT /api/company)
//   2. People (the HUMANS in the company; roster + add/edit/remove)
//   3. Org chart (humans + AI agents, GET /api/company/org) — who reports to whom
import { useEffect, useState } from "react";
import { Panel, Button, Input, Icon, Badge, IconButton, EmptyState, Switch, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Person, NewPerson, OrgNode } from "@jarvis/shared";

interface CompanyProfile {
  name: string;
  domain: string;
  industry: string;
  size: string;
  coreBusiness: string;
  notes?: string;
}

// Shared label + field styling (matches the HUD dark aesthetic).
const labelStyle = {
  font: "var(--fw-semibold) 10px var(--font-hud)",
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--jv-text-muted)",
  marginBottom: 6,
  display: "block",
};

function textareaStyle(): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 76,
    resize: "vertical",
    padding: "10px 12px",
    borderRadius: "var(--r-sm)",
    background: "rgba(4, 12, 22, 0.6)",
    border: "1px solid var(--jv-border)",
    color: "var(--jv-text)",
    font: "var(--fw-regular) 13px/1.5 var(--font-body)",
    outline: "none",
    boxSizing: "border-box",
  };
}

function selectStyle(): React.CSSProperties {
  return {
    width: "100%",
    height: 40,
    padding: "0 10px",
    borderRadius: "var(--r-sm)",
    background: "rgba(4, 12, 22, 0.6)",
    border: "1px solid var(--jv-border)",
    color: "var(--jv-text)",
    font: "var(--fw-regular) 13px var(--font-body)",
    outline: "none",
  };
}

// ---------------------------------------------------------------------------
// 1) Company profile onboarding form
// ---------------------------------------------------------------------------
function ProfileSection() {
  const { data } = useApi<CompanyProfile>("/api/company");
  const [form, setForm] = useState<CompanyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const set = (k: keyof CompanyProfile, v: string) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  };

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const next = await api.put<CompanyProfile>("/api/company", form);
      setForm(next);
      setSaved(true);
    } catch {
      /* leave the form as-is on failure */
    } finally {
      setSaving(false);
    }
  };

  const f = form;

  return (
    <Panel
      title="Company profile"
      brackets
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saved && !saving && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-green)" }}>
              <Icon name="check" size={13} /> Saved
            </span>
          )}
          <Button size="sm" variant="primary" icon={<Icon name="save" size={13} />} disabled={!f || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <p style={{ margin: "0 0 18px", font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>
        Start here. Tell After Human everything about your company — this profile grounds every agent you build so its
        recommendations, tone, and setup fit who you actually are.
      </p>

      {!f ? (
        <div style={{ font: "var(--fw-regular) 12.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Loading company profile…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={labelStyle}>Company name</label>
              <Input placeholder="e.g. Go Perfect" value={f.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Domain</label>
              <Input placeholder="e.g. goperfectmatch.com" value={f.domain} onChange={(e) => set("domain", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Industry</label>
              <Input placeholder="e.g. AI recruiting / HR tech" value={f.industry} onChange={(e) => set("industry", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Size</label>
              <Input placeholder="e.g. Startup · 12 people" value={f.size} onChange={(e) => set("size", e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Core business</label>
            <textarea
              placeholder="What does the company do? The core business, products, and who you serve."
              value={f.coreBusiness}
              onChange={(e) => set("coreBusiness", e.target.value)}
              style={textareaStyle()}
            />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              placeholder="Anything else worth knowing — culture, priorities, constraints, key context."
              value={f.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              style={textareaStyle()}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 2) People roster (the humans)
// ---------------------------------------------------------------------------
const EMPTY_PERSON: NewPerson = { name: "", title: "", email: "", department: "", reportsToId: null, isYou: false };

function PersonForm({
  people,
  initial,
  busy,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  people: Person[];
  initial: NewPerson;
  busy: boolean;
  onSubmit: (p: NewPerson) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<NewPerson>(initial);
  const set = <K extends keyof NewPerson>(k: K, v: NewPerson[K]) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = !!form.name.trim() && !busy;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: "var(--r-sm)",
        background: "var(--jv-surface-3)",
        border: "1px solid var(--jv-border-cyan)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <Input placeholder="Full name" value={form.name} autoFocus onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Title</label>
          <Input placeholder="e.g. Head of Sales" value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <Input placeholder="name@company.com" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Department</label>
          <Input placeholder="e.g. Sales" value={form.department ?? ""} onChange={(e) => set("department", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Reports to</label>
          <select value={form.reportsToId ?? ""} onChange={(e) => set("reportsToId", e.target.value || null)} style={selectStyle()}>
            <option value="">— Top of org —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.title ? ` · ${p.title}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Switch checked={!!form.isYou} onChange={(v) => set("isYou", v)} />
            <span style={{ font: "var(--fw-medium) 12px var(--font-body)", color: "var(--jv-text-soft)" }}>This is you</span>
          </span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!canSave} onClick={() => onSubmit(form)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function PeopleSection({ onChanged }: { onChanged: () => void }) {
  const { data, reload } = useApi<Person[]>("/api/company/people");
  const people = data ?? [];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const nameById = (id?: string | null) => (id ? people.find((p) => p.id === id)?.name : undefined);

  const add = async (p: NewPerson) => {
    setBusy(true);
    try {
      await api.post("/api/company/people", p);
      setAdding(false);
      reload();
      onChanged();
    } catch {
      /* keep form open on failure */
    } finally {
      setBusy(false);
    }
  };

  const update = async (id: string, p: NewPerson) => {
    setBusy(true);
    try {
      await api.put(`/api/company/people/${id}`, p);
      setEditing(null);
      reload();
      onChanged();
    } catch {
      /* keep form open on failure */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await api.del(`/api/company/people/${id}`);
      reload();
      onChanged();
    } catch {
      /* ignore */
    } finally {
      setDeleting(false);
      setConfirmId(null);
    }
  };

  return (
    <Panel
      title="People"
      action={
        !adding && (
          <Button size="sm" variant="secondary" icon={<Icon name="user-plus" size={13} />} onClick={() => setAdding(true)}>
            Add person
          </Button>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {adding && (
          <PersonForm people={people} initial={EMPTY_PERSON} busy={busy} onSubmit={add} onCancel={() => setAdding(false)} submitLabel="Add person" />
        )}

        {people.length === 0 && !adding ? (
          <EmptyState
            compact
            icon="users"
            title="No people yet"
            hint="Onboard the humans in your company — add their name, title, department, and who they report to."
            action={
              <Button size="sm" variant="secondary" icon={<Icon name="user-plus" size={13} />} onClick={() => setAdding(true)}>
                Add person
              </Button>
            }
          />
        ) : (
          people.map((p) =>
            editing === p.id ? (
              <PersonForm
                key={p.id}
                people={people.filter((o) => o.id !== p.id)}
                initial={{
                  name: p.name,
                  title: p.title ?? "",
                  email: p.email ?? "",
                  department: p.department ?? "",
                  reportsToId: p.reportsToId ?? null,
                  isYou: p.isYou ?? false,
                  notes: p.notes ?? "",
                }}
                busy={busy}
                onSubmit={(np) => update(p.id, np)}
                onCancel={() => setEditing(null)}
                submitLabel="Save changes"
              />
            ) : (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: "var(--r-sm)",
                  background: "var(--jv-surface-3)",
                  border: "1px solid var(--jv-border-soft)",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    flex: "0 0 34px",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    color: "var(--jv-cyan)",
                    background: "var(--grad-cyan-soft)",
                    border: "1px solid var(--jv-border-cyan)",
                  }}
                >
                  <Icon name="user-round" size={17} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ font: "var(--fw-semibold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{p.name}</span>
                    {p.isYou && <Badge status="info">You</Badge>}
                  </div>
                  <div style={{ marginTop: 2, font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)" }}>
                    {[p.title, p.department].filter(Boolean).join(" · ") || "—"}
                    {p.email ? ` · ${p.email}` : ""}
                    {nameById(p.reportsToId) ? ` · reports to ${nameById(p.reportsToId)}` : ""}
                  </div>
                </div>
                <IconButton icon="pencil" tone="cyan" title="Edit" onClick={() => setEditing(p.id)} />
                <IconButton icon="trash-2" tone="danger" title="Remove" onClick={() => setConfirmId(p.id)} />
              </div>
            ),
          )
        )}
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        danger
        title="Remove this person?"
        message="They'll be removed from the roster and org chart. Anyone who reported to them moves to the top of the org."
        confirmLabel="Remove"
        busy={deleting}
        onConfirm={() => confirmId && remove(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 3) Org chart (humans + agents)
// ---------------------------------------------------------------------------
function OrgTreeNode({ node, depth }: { node: OrgNode; depth: number }) {
  const isAgent = node.kind === "agent";
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 18 }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          marginBottom: 8,
          borderRadius: "var(--r-sm)",
          background: "var(--jv-surface-3)",
          border: `1px solid ${isAgent ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`,
          borderLeft: depth > 0 ? "2px solid var(--jv-border-cyan)" : `1px solid ${isAgent ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            flex: "0 0 30px",
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            color: isAgent ? "var(--jv-cyan)" : "var(--jv-text-soft)",
            background: isAgent ? "var(--grad-cyan-soft)" : "rgba(4,12,22,0.5)",
            border: `1px solid ${isAgent ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`,
          }}
        >
          <Icon name={node.icon || (isAgent ? "bot" : "user-round")} size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ font: "var(--fw-semibold) 13px var(--font-body)", color: "var(--jv-text)" }}>{node.name}</span>
            {isAgent && <Badge status="info">Agent</Badge>}
          </div>
          {(node.title || node.department) && (
            <div style={{ marginTop: 1, font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>
              {[node.title, node.department].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <div style={{ paddingLeft: 10, borderLeft: "1px solid var(--jv-hairline)", marginLeft: 15 }}>
          {node.children.map((c) => (
            <OrgTreeNode key={`${c.kind}-${c.id}`} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgSection({ reloadKey }: { reloadKey: number }) {
  const { data } = useApi<OrgNode[]>("/api/company/org", [reloadKey]);
  const roots = data ?? [];

  const legendDot = (color: string, icon: string, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "var(--fw-medium) 11px var(--font-body)", color: "var(--jv-text-muted)" }}>
      <span
        style={{
          width: 20,
          height: 20,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          color,
          background: "rgba(4,12,22,0.5)",
          border: `1px solid ${color === "var(--jv-cyan)" ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`,
        }}
      >
        <Icon name={icon} size={11} />
      </span>
      {label}
    </span>
  );

  return (
    <Panel
      title="Org chart"
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {legendDot("var(--jv-text-soft)", "user-round", "Human")}
          {legendDot("var(--jv-cyan)", "bot", "Agent")}
        </div>
      }
    >
      {roots.length === 0 ? (
        <EmptyState compact icon="git-branch" title="No org yet" hint="Add people above and hire agents — they'll appear here showing who reports to whom." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {roots.map((n) => (
            <OrgTreeNode key={`${n.kind}-${n.id}`} node={n} depth={0} />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
export default function Company() {
  // Bumped whenever people change, so the org chart refetches.
  const [orgKey, setOrgKey] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ProfileSection />
      <PeopleSection onChanged={() => setOrgKey((k) => k + 1)} />
      <OrgSection reloadKey={orgKey} />
    </div>
  );
}
