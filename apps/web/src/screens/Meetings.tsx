// Meetings — send an AI bot (Recall.ai) into a live Zoom / Google Meet / Teams
// call, watch its status, and read the transcript. Master (list + send form) on
// the left, the selected meeting's live status + transcript on the right.
import { useEffect, useRef, useState } from "react";
import { Panel, Button, Input, Icon, Badge, EmptyState, IconButton, ConfirmDialog } from "../ds";
import { useApi } from "../api/hooks";
import { api } from "../api/client";
import type { Meeting } from "@jarvis/shared";

// Loosely map a meeting's backend status string onto a DS Badge Tone.
type Tone = "optimal" | "info" | "warn" | "critical" | "standby" | "neutral" | "live";
function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s.includes("error") || s.includes("fatal") || s.includes("fail")) return "critical";
  if (s.includes("record")) return "live";
  if (s.includes("call") || s.includes("join")) return "optimal";
  if (s.includes("done") || s.includes("left") || s.includes("end")) return "neutral";
  return "neutral";
}

// A meeting is "active" (worth auto-refreshing) while the bot is on its way in
// or in the call.
function isActive(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("join") || s.includes("call") || s.includes("record");
}

const fmtWhen = (iso: string) => {
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------------------
// Send-a-bot form
// ---------------------------------------------------------------------------
function SendBotForm({ onSent }: { onSent: (m: Meeting) => void }) {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [botName, setBotName] = useState("");
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<"record" | "present">("present");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const url = meetingUrl.trim();
    if (!url || sending) return;
    setSending(true);
    setError(null);
    const name = botName.trim();
    try {
      if (mode === "present") {
        const r = await api.post<{ botId?: string }>("/api/meetings/present", { meetingUrl: url, topic: topic.trim() || undefined, botName: name || undefined });
        setMeetingUrl(""); setTopic("");
        onSent({ id: r.botId || "", meetingUrl: url, botName: name || "After Human AI", status: "presenting", createdAt: new Date().toISOString() });
      } else {
        const m = await api.post<Meeting>("/api/meetings/join", { meetingUrl: url, botName: name || undefined });
        setMeetingUrl(""); setBotName("");
        onSent(m);
      }
    } catch {
      setError(mode === "present" ? "Couldn't start the presentation. Check the link and try again." : "Couldn't send the bot. Check the meeting link and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Panel
      title="Send a bot to a meeting"
      brackets
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {/* Mode: Present (bot speaks + shares the product) vs Record (join + transcribe) */}
      <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: "var(--r-pill)", background: "var(--jv-void)", border: "1px solid var(--jv-border-soft)", alignSelf: "flex-start" }}>
        {([["present", "presentation", "Present live demo"], ["record", "captions", "Just record"]] as const).map(([m, ic, label]) => {
          const on = mode === m;
          return (
            <button key={m} onClick={() => setMode(m)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: "var(--r-pill)", cursor: "pointer", border: "none", background: on ? "var(--grad-cyan)" : "transparent", color: on ? "var(--accent-contrast)" : "var(--jv-text-muted)", font: `${on ? "var(--fw-semibold)" : "var(--fw-medium)"} 11px var(--font-hud)`, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <Icon name={ic} size={12} /> {label}
            </button>
          );
        })}
      </div>
      <p style={{ margin: 0, font: "var(--fw-regular) 13px/1.6 var(--font-body)", color: "var(--jv-text-soft)" }}>
        {mode === "present"
          ? "The AI joins the call, shares the live product on screen, and narrates a demo in your voice. Paste a Zoom / Meet / Teams link."
          : "Send an AI bot into a live call to record + transcribe it. Paste a Zoom / Meet / Teams link."}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
        <Input
          icon={<Icon name="link" size={15} />}
          placeholder="https://zoom.us/j/… · meet.google.com/… · teams.microsoft.com/…"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <Input
          icon={<Icon name="users" size={15} />}
          placeholder="After Human"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
      </div>
      {mode === "present" && (
        <Input
          icon={<Icon name="sparkles" size={15} />}
          placeholder="What to focus the demo on (optional) — e.g. 'outbound sourcing for a Head of Talent'"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }} />
        <Button
          size="md"
          variant="primary"
          icon={<Icon name={sending ? "loader" : mode === "present" ? "presentation" : "video"} size={14} />}
          disabled={sending || meetingUrl.trim().length === 0}
          onClick={send}
        >
          {sending ? (mode === "present" ? "Starting…" : "Sending…") : mode === "present" ? "Send AI presenter" : "Send bot"}
        </Button>
      </div>
      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "9px 12px", borderRadius: "var(--r-sm)", color: "var(--jv-red)", background: "color-mix(in srgb, var(--jv-red) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--jv-red) 30%, transparent)", font: "var(--fw-medium) 12px/1.5 var(--font-body)" }}>
          <Icon name="octagon-x" size={13} />
          <span style={{ flex: 1 }}>{error}</span>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Meeting list (rows) — click to select, trash to remove (bot leaves).
// ---------------------------------------------------------------------------
function MeetingRow({ m, selected, onSelect, onDelete }: { m: Meeting; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: "var(--r-sm)",
        cursor: "pointer",
        background: selected ? "var(--grad-cyan-soft)" : "var(--jv-surface-3)",
        border: `1px solid ${selected ? "var(--jv-border-cyan)" : "var(--jv-border-soft)"}`,
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
        <Icon name="video" size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "var(--fw-semibold) 13.5px var(--font-body)", color: "var(--jv-text)" }}>{m.botName || "After Human"}</span>
          <Badge status={statusTone(m.status)} dot={statusTone(m.status) === "live"}>{m.status}</Badge>
        </div>
        <div style={{ marginTop: 2, font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--jv-cyan-300)", textDecoration: "none" }}>{m.meetingUrl}</a>
          {` · ${fmtWhen(m.createdAt)}`}
        </div>
      </div>
      <IconButton icon="trash-2" tone="danger" title="Bot leaves the call" onClick={(e) => { e.stopPropagation(); onDelete(); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail — live status + transcript for the selected meeting. Own useApi keyed
// on the id, with a manual Refresh and a light auto-refresh while active.
// ---------------------------------------------------------------------------
function MeetingDetail({ id }: { id: string }) {
  const { data, reload } = useApi<Meeting>(`/api/meetings/${id}`, [id]);
  const m = data;
  const [say, setSay] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [speakErr, setSpeakErr] = useState<string | null>(null);
  const speak = async () => {
    const t = say.trim();
    if (!t || speaking) return;
    setSpeaking(true); setSpeakErr(null);
    try { await api.post(`/api/meetings/${id}/speak`, { text: t }); setSay(""); }
    catch { setSpeakErr("Couldn't speak — the bot must be in the call (and a voice provider connected)."); }
    finally { setSpeaking(false); }
  };

  // Light auto-refresh (~10s) of the selected meeting while its status is
  // active, so the transcript and status stream in without manual clicks.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const active = m ? isActive(m.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => reloadRef.current(), 10000);
    return () => clearInterval(t);
  }, [active, id]);

  const transcript = m?.transcript ?? [];

  return (
    <Panel
      title="Meeting"
      eyebrow
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {m && <Badge status={statusTone(m.status)} dot={statusTone(m.status) === "live"} solid>{m.status}</Badge>}
          <Button size="sm" variant="secondary" icon={<Icon name="refresh-cw" size={13} />} onClick={reload}>Refresh</Button>
        </div>
      }
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {!m ? (
        <div style={{ font: "var(--fw-regular) 12.5px var(--font-body)", color: "var(--jv-text-muted)" }}>Loading meeting…</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)" }}>
            <Icon name="link" size={14} color="var(--jv-cyan)" />
            <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "var(--fw-medium) 12px var(--font-mono)", color: "var(--jv-cyan-300)", textDecoration: "none" }}>{m.meetingUrl}</a>
          </div>

          {/* Make the AI say something out loud in the call, on demand */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Input
              icon={<Icon name="mic" size={15} />}
              placeholder="Type something for the AI to say in the call…"
              value={say}
              onChange={(e) => setSay(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && speak()}
            />
            <Button size="md" variant="primary" icon={<Icon name={speaking ? "loader" : "volume-2"} size={14} />} disabled={speaking || !say.trim()} onClick={speak}>
              {speaking ? "…" : "Speak"}
            </Button>
          </div>
          {speakErr && <div style={{ font: "var(--fw-regular) 11.5px var(--font-body)", color: "var(--jv-amber)" }}>{speakErr}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--jv-text-muted)" }}>
            <Icon name="file-text" size={13} color="var(--jv-text-muted)" />Transcript
          </div>
          {transcript.length === 0 ? (
            <div style={{ font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-faint)", padding: "8px 0" }}>
              No transcript yet — it appears once the bot has been in the call.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", borderRadius: "var(--r-sm)", background: "var(--jv-void)", border: "1px solid var(--jv-border)", padding: "12px 14px" }}>
              {transcript.map((line, i) => (
                <div key={i} style={{ font: "var(--fw-regular) 12.5px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>
                  {line.speaker && <span style={{ font: "var(--fw-semibold) 12.5px var(--font-body)", color: "var(--jv-cyan-300)" }}>{line.speaker}: </span>}
                  {line.text}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
export default function Meetings() {
  const { data, reload } = useApi<Meeting[]>("/api/meetings");
  const meetings = data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const onSent = (m: Meeting) => {
    reload();
    setSelected(m.id);
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await api.del(`/api/meetings/${id}`);
      if (selected === id) setSelected(null);
      reload();
    } catch {
      /* ignore */
    } finally {
      setDeleting(false);
      setConfirmId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SendBotForm onSent={onSent} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <Panel title="Meetings" action={<Badge status="info" dot={false}>{String(meetings.length)}</Badge>} bodyStyle={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {meetings.length === 0 ? (
            <EmptyState compact icon="video" title="No meetings yet" hint="Send a bot to a Zoom, Google Meet, or Teams call above — it'll show up here with live status." />
          ) : (
            meetings.map((m) => (
              <MeetingRow
                key={m.id}
                m={m}
                selected={selected === m.id}
                onSelect={() => setSelected(m.id)}
                onDelete={() => setConfirmId(m.id)}
              />
            ))
          )}
        </Panel>

        {selected ? (
          <MeetingDetail id={selected} />
        ) : (
          <Panel title="Meeting" eyebrow>
            <EmptyState compact icon="file-text" title="No meeting selected" hint="Select a meeting on the left to see its live status and transcript." />
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        danger
        title="Remove the bot from this call?"
        message="The bot leaves the call and the meeting is removed from the list."
        confirmLabel="Bot leaves"
        busy={deleting}
        onConfirm={() => confirmId && remove(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
