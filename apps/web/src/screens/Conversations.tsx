import { useEffect, useRef, useState } from "react";
import { Icon, Input, EmptyState } from "../ds";
import { useApi } from "../api/hooks";
import { api, streamChat } from "../api/client";
import type { Conversation, ChatMessage } from "@jarvis/shared";

const MODES: [string, string, string, string][] = [
  ["code", "Compose", "Write and create", "var(--jv-cyan)"],
  ["search", "Research", "Deep analysis", "var(--jv-violet)"],
  ["workflow", "Execute", "Run and automate", "var(--jv-green)"],
  ["bug", "Debug", "Fix and optimize", "var(--jv-amber)"],
  ["sparkles", "Brainstorm", "Ideas and strategy", "var(--jv-magenta)"],
];

function ModeCard({ ic, name, sub, color, active, onClick }: { ic: string; name: string; sub: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 130,
        textAlign: "left",
        padding: "14px 15px",
        borderRadius: "var(--r-md)",
        background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "var(--jv-surface-2)",
        border: `1px solid ${active ? color : "var(--jv-border-soft)"}`,
        cursor: "pointer",
        boxShadow: active ? `0 0 18px color-mix(in srgb, ${color} 40%, transparent)` : "none",
        transition: "all .15s",
      }}
    >
      <span style={{ color, display: "inline-flex", marginBottom: 10 }}>
        <Icon name={ic} size={20} />
      </span>
      <div style={{ font: "var(--fw-bold) 14px var(--font-body)", color: "var(--jv-text)" }}>{name}</div>
      <div style={{ font: "var(--fw-regular) 11px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 2 }}>{sub}</div>
    </button>
  );
}

export default function Conversations() {
  const { data } = useApi<Conversation[]>("/api/memory/conversations");
  const sessions = data ?? [];

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Generation token: stray deltas from an abandoned turn no-op instead of
  // appending to a newly-opened conversation.
  const turnRef = useRef(0);

  useEffect(() => {
    // scrollIntoView finds the real scroll container regardless of DOM nesting.
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread]);

  const filtered = query.trim()
    ? sessions.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sessions;

  const sessionId = sel != null ? filtered[sel]?.sessionId ?? null : null;

  // Load a past conversation's transcript when one is selected. New-chat (sel
  // null) leaves the thread as-is so streaming sends aren't clobbered.
  useEffect(() => {
    if (sel == null || !sessionId) return;
    const turn = ++turnRef.current; // invalidate any in-flight stream/load
    let alive = true;
    setThread([]);
    setLoadingThread(true);
    api
      .get<ChatMessage[]>(`/api/memory/conversations/${encodeURIComponent(sessionId)}`)
      .then((msgs) => {
        if (alive && turn === turnRef.current) setThread(Array.isArray(msgs) ? msgs : []);
      })
      .catch(() => {
        if (alive && turn === turnRef.current) setThread([]);
      })
      .finally(() => alive && turn === turnRef.current && setLoadingThread(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sel]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const turn = ++turnRef.current;
    setDraft("");
    setThread((t) => [...t, { who: "you", text }, { who: "jarvis", text: "" }]);
    setBusy(true);
    try {
      await streamChat({ message: text, mode, sessionId }, (delta) => {
        setThread((t) => {
          if (turn !== turnRef.current) return t; // conversation switched — drop stray delta
          const next = t.slice();
          const last = next[next.length - 1];
          if (last && last.who === "jarvis") next[next.length - 1] = { who: "jarvis", text: last.text + delta };
          return next;
        });
      });
    } catch {
      setThread((t) => {
        const next = t.slice();
        const last = next[next.length - 1];
        if (last && last.who === "jarvis" && !last.text) next[next.length - 1] = { who: "jarvis", text: "I couldn't reach the agent gateway just now." };
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  const hasThread = thread.length > 0 || sel !== null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", background: "var(--grad-panel)", borderRadius: "var(--r-md)", border: "1px solid var(--jv-border)", boxShadow: "var(--panel-shadow)", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid var(--jv-hairline)" }}>
          <div style={{ flex: 1 }}>
            <Input
              icon={<Icon name="search" size={15} />}
              placeholder="Search conversations"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSel(null);
              }}
            />
          </div>
          <button
            disabled={busy}
            style={{ width: 38, flex: "0 0 38px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan-300)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
            onClick={() => {
              turnRef.current++; // invalidate any in-flight stream
              setSel(null);
              setThread([]);
            }}
          >
            <Icon name="plus" size={17} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <EmptyState
              compact
              icon="message-square"
              title={query.trim() ? "No matches" : "No conversations yet"}
              hint={query.trim() ? "No conversations match your search." : "Start a new chat to begin talking with JARVIS."}
            />
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => {
                  turnRef.current++; // invalidate any in-flight stream
                  setSel(i);
                  setThread([]);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "11px 16px",
                  background: sel === i ? "var(--grad-cyan-soft)" : "none",
                  borderLeft: sel === i ? "2px solid var(--jv-cyan)" : "2px solid transparent",
                  border: "none",
                  borderBottom: "1px solid var(--jv-hairline)",
                  cursor: "pointer",
                  font: "var(--fw-medium) 12.5px var(--font-body)",
                  color: sel === i ? "var(--jv-text)" : "var(--jv-text-soft)",
                }}
              >
                {c.title}
              </button>
            ))
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", padding: hasThread ? "8px 8px 16px" : 0 }}>
          {!hasThread ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ font: "var(--fw-semibold) 26px var(--font-body)", color: "var(--jv-text)" }}>How can I assist you?</div>
              <div style={{ font: "var(--fw-regular) 13px var(--font-body)", color: "var(--jv-text-muted)", marginTop: 6 }}>Pick a mode or just type your question below.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto" }}>
              {loadingThread && thread.length === 0 && (
                <div style={{ alignSelf: "center", padding: "20px 0", color: "var(--jv-text-muted)", font: "var(--fw-regular) 12.5px var(--font-body)" }}>
                  Loading conversation…
                </div>
              )}
              {!loadingThread && thread.length === 0 && sel !== null && (
                <div style={{ alignSelf: "center", padding: "20px 0", color: "var(--jv-text-muted)", font: "var(--fw-regular) 12.5px var(--font-body)" }}>
                  No messages in this conversation yet.
                </div>
              )}
              {thread.map((m, i) =>
                m.who === "you" ? (
                  <div
                    key={i}
                    style={{ alignSelf: "flex-end", maxWidth: "78%", padding: "10px 14px", borderRadius: "12px 12px 3px 12px", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", font: "var(--fw-medium) 13px/1.5 var(--font-body)", color: "var(--jv-text)" }}
                  >
                    {m.text}
                  </div>
                ) : (
                  <div key={i} style={{ alignSelf: "flex-start", maxWidth: "84%", display: "flex", gap: 10 }}>
                    <span style={{ flex: "0 0 28px", width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-cyan)", color: "var(--jv-cyan)" }}>
                      <Icon name="sparkles" size={14} />
                    </span>
                    <div style={{ padding: "10px 14px", borderRadius: "12px 12px 12px 3px", background: "var(--jv-surface-3)", border: "1px solid var(--jv-border-soft)", font: "var(--fw-regular) 13px/1.55 var(--font-body)", color: "var(--jv-text-soft)" }}>
                      {m.text || <span style={{ opacity: 0.5 }}>…</span>}
                    </div>
                  </div>
                ),
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div style={{ paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, justifyContent: hasThread ? "flex-start" : "center", flexWrap: "wrap" }}>
            {MODES.map((m) => (
              <ModeCard key={m[1]} ic={m[0]} name={m[1]} sub={m[2]} color={m[3]} active={mode === m[1]} onClick={() => setMode((v) => (v === m[1] ? null : m[1]))} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 8px 16px", borderRadius: "var(--r-md)", background: "var(--jv-void)", border: "1px solid var(--jv-border-cyan)", boxShadow: "0 0 20px rgba(41,211,245,0.08)" }}>
            {mode && (
              <span style={{ padding: "4px 9px", borderRadius: "var(--r-pill)", font: "var(--fw-semibold) 10px var(--font-hud)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--jv-cyan-300)", background: "var(--grad-cyan-soft)", border: "1px solid var(--jv-border-cyan)", whiteSpace: "nowrap" }}>
                {mode}
              </span>
            )}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type / for commands, or ask anything…"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--jv-text)", font: "var(--fw-medium) 13.5px var(--font-body)" }}
            />
            <button
              onClick={send}
              disabled={busy}
              style={{
                width: 38,
                height: 38,
                flex: "0 0 38px",
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                background: draft.trim() ? "var(--jv-cyan)" : "var(--jv-surface-3)",
                border: "none",
                color: draft.trim() ? "var(--accent-contrast)" : "var(--jv-text-muted)",
                cursor: busy ? "default" : "pointer",
                boxShadow: draft.trim() ? "var(--glow-cyan)" : "none",
              }}
            >
              <Icon name={busy ? "loader" : "arrow-up"} size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
