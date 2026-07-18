import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "../pds.css";
import { DPA_TEMPLATE_MD } from "../legal/dpaTemplate";

// ============================================================
// DATA GOVERNANCE (#2) — DPA viewer + download.
// Renders the canonical DPA_TEMPLATE_MD with a tiny self-
// contained markdown renderer (headings, lists, bold, tables,
// rules, paragraphs) and a "Download .md" button. Namespaced +
// scoped under .pds; imports only pds.css, no shared-style edits.
// ============================================================

const nav = (view: string) => window.dispatchEvent(new CustomEvent("pds-nav", { detail: { view } }));
const btnFont: CSSProperties = { fontFamily: "inherit", cursor: "pointer" };

// Inline **bold** -> <strong>. Kept intentionally minimal.
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) out.push(<strong key={`${keyBase}-b${i}`}>{p.slice(2, -2)}</strong>);
    else if (p) out.push(p);
  });
  return out;
}

function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let table: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    nodes.push(
      <ul key={`ul${key++}`} style={{ margin: "0 0 16px", paddingLeft: 22, color: "var(--ink2)", lineHeight: 1.7, fontSize: 15 }}>
        {items.map((it, i) => <li key={i}>{inline(it, `li${key}-${i}`)}</li>)}
      </ul>,
    );
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\s*\|?\s*-{2,}/.test(r)); // drop the |---| separator
    table = [];
    const cells = (r: string) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const [head, ...body] = rows;
    nodes.push(
      <div key={`tbl${key++}`} style={{ overflowX: "auto", margin: "0 0 18px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, border: "1px solid var(--border)", borderRadius: 12 }}>
          {head && (
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink3)", fontSize: 11.5, letterSpacing: ".04em", textTransform: "uppercase" }}>
                {cells(head).map((c, i) => <th key={i} style={{ padding: "12px 16px", fontWeight: 700 }}>{c}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri} style={{ borderTop: "1px solid var(--divider)" }}>
                {cells(r).map((c, ci) => <td key={ci} style={{ padding: "12px 16px", color: ci === 0 ? "var(--ink1)" : "var(--ink2)", fontWeight: ci === 0 ? 700 : 400 }}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().startsWith("|")) { flushList(); table.push(line); continue; }
    if (table.length) flushTable();

    if (/^-\s+/.test(line.trim())) { list.push(line.trim().replace(/^-\s+/, "")); continue; }
    if (list.length) flushList();

    if (line.trim() === "") continue;
    if (line.trim() === "---") { nodes.push(<hr key={`hr${key++}`} style={{ border: "none", borderTop: "1px solid var(--divider)", margin: "24px 0" }} />); continue; }
    if (line.startsWith("### ")) { nodes.push(<h3 key={`h3${key++}`} style={{ margin: "22px 0 8px", fontSize: 17, fontWeight: 700 }}>{inline(line.slice(4), `h3${key}`)}</h3>); continue; }
    if (line.startsWith("## ")) { nodes.push(<h2 key={`h2${key++}`} style={{ margin: "30px 0 10px", fontSize: 22, fontWeight: 700, letterSpacing: "-.01em" }}>{inline(line.slice(3), `h2${key}`)}</h2>); continue; }
    if (line.startsWith("# ")) { nodes.push(<h1 key={`h1${key++}`} style={{ margin: "0 0 14px", fontSize: 34, fontWeight: 800, letterSpacing: "-.02em" }}>{inline(line.slice(2), `h1${key}`)}</h1>); continue; }
    nodes.push(<p key={`p${key++}`} style={{ margin: "0 0 14px", fontSize: 15, color: "var(--ink2)", lineHeight: 1.6 }}>{inline(line, `p${key}`)}</p>);
  }
  flushList();
  flushTable();
  return nodes;
}

export default function DpaPage() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const dark = theme === "dark";
  const bg = dark ? "#04042A" : "#FFFEFE";
  const navBg = dark ? "rgba(16,16,60,.72)" : "rgba(255,255,255,.7)";
  const navBorder = dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.7)";

  const download = () => {
    const blob = new Blob([DPA_TEMPLATE_MD], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "AfterHuman-DPA-template.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pds pds-scroll" data-theme={theme} style={{ height: "100vh", overflowY: "auto", background: bg, color: "var(--ink1)", transition: "background .2s ease" }}>
      {/* NAV */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, padding: "16px 24px 6px" }}>
        <nav style={{ maxWidth: 860, margin: "0 auto", height: 62, borderRadius: 9999, background: navBg, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: `1px solid ${navBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,.08)", display: "flex", alignItems: "center", gap: 14, padding: "0 12px 0 22px" }}>
          <button onClick={() => nav("trust")} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", padding: 0, ...btnFont }}>
            <img src="/assets/afterhuman-mark.svg" alt="AfterHuman" style={{ width: 32, height: 32, display: "block" }} />
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em", color: "var(--ink1)" }}>AfterHuman</div>
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={() => nav("trust")} style={{ border: "none", background: "transparent", padding: 0, fontSize: 14, fontWeight: 500, color: "var(--ink2)", ...btnFont }}>Trust</button>
            <button onClick={download} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 40, padding: "0 16px", borderRadius: 9999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 700, ...btnFont }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>download</span>Download .md
            </button>
            <button onClick={() => setTheme(dark ? "light" : "dark")} title="Toggle theme" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--ink1)", display: "flex", alignItems: "center", justifyContent: "center", ...btnFont }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{dark ? "light_mode" : "dark_mode"}</span>
            </button>
          </div>
        </nav>
      </div>

      {/* DOC */}
      <article style={{ maxWidth: 820, margin: "0 auto", padding: "40px 24px 90px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: ".02em", padding: "6px 12px", borderRadius: 9999, background: "var(--ghost)", color: "var(--ink2)", marginBottom: 20 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>description</span>Template — for customer execution
        </div>
        {renderMarkdown(DPA_TEMPLATE_MD)}
      </article>
    </div>
  );
}
