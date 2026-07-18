// ============================================================
// CLONE CALENDAR READER — password-auth (IMAP) meeting discovery.
//
// The clone's meeting account is a real dedicated mailbox with
// email + username + PASSWORD (no OAuth). We therefore read its calendar the
// only way password auth allows across Gmail / Outlook / generic hosts: connect
// to the mailbox over IMAPS (TLS/993), pull recent messages, and parse the
// meeting-invite iCalendar parts (text/calendar / *.ics) into CalEvent[].
//
// From each VEVENT we extract:
//   externalId  ← UID          (stable id → scheduled_calls dedupe key)
//   title       ← SUMMARY
//   startAt     ← DTSTART       (UTC; TZID resolved via Intl, floating→UTC)
//   link        ← the Zoom/Meet/Teams/Webex URL found in LOCATION / URL /
//                 X-*-CONFERENCE / DESCRIPTION / raw body
//
// FAIL-SAFE: every public entry point returns [] on any connection/parse error
// and never throws into the scheduler. Zero new npm deps — pure node:tls +
// node:crypto (Intl for timezones).
//
// PROVIDER / APP-PASSWORD CAVEAT: Google (imap.gmail.com) and Microsoft
// (outlook.office365.com) have largely disabled *basic* password auth. For those
// providers the stored "password" must be an APP PASSWORD (Google: 2FA →
// App Passwords; Microsoft: tenant must still permit IMAP basic auth / an app
// password), not the human login password. Generic/self-hosted IMAP servers
// accept the real password. imapHost() maps provider→host; an explicit host can
// be supplied as the provider string (e.g. "imap.fastmail.com").
// ============================================================
import * as tls from "node:tls";

export type CalEvent = { externalId: string; title: string; link: string; startAt: string };

export type MeetingAccount = { email: string; username: string; password: string; provider: string };

// Overall wall-clock budget for one poll; the scheduler runs us every 60s.
const OVERALL_TIMEOUT_MS = 25_000;
// Look back this far for invites (a future meeting's invite usually arrived recently).
const SINCE_DAYS = 45;
// Cap the messages we fetch so a busy mailbox can't blow the budget/memory.
const MAX_MESSAGES = 60;
const IMAP_PORT = 993;

// ---- provider → IMAP host ---------------------------------------------------
export function imapHost(provider: string, email: string): string {
  const p = (provider || "").toLowerCase().trim();
  const domain = (email.split("@")[1] || "").toLowerCase().trim();
  if (/gmail|google/.test(p) || domain === "gmail.com" || domain === "googlemail.com") return "imap.gmail.com";
  if (/outlook|office|o365|microsoft|hotmail|\blive\b|msft/.test(p) || /outlook|hotmail|^live\./.test(domain)) {
    return "outlook.office365.com";
  }
  // An explicit host handed in as the provider string (e.g. "imap.fastmail.com").
  if (/^imap\./i.test(p)) return p;
  if (p.includes(".") && !p.includes(" ")) return p;
  if (domain) return "imap." + domain;
  return "";
}

// ---- tiny IMAP client (TLS, literal-aware) ----------------------------------
// Reads only what we need: LOGIN → SELECT INBOX → UID SEARCH SINCE → UID FETCH
// (BODY.PEEK[]) → LOGOUT. Literal-aware framing so message bodies that contain
// "TAG OK" text can't fool completion detection.
function findTagCompletion(buf: Buffer, tag: string): number {
  const s = buf.toString("latin1"); // latin1 ⇒ 1 char == 1 byte, indices == byte offsets
  let i = 0;
  while (i < s.length) {
    const eol = s.indexOf("\r\n", i);
    if (eol === -1) return -1;
    const line = s.slice(i, eol);
    const lit = /\{(\d+)\}$/.exec(line);
    if (lit) {
      const end = eol + 2 + parseInt(lit[1], 10);
      if (end > s.length) return -1; // literal not fully received yet
      i = end;
      continue;
    }
    if (line.startsWith(tag + " ")) {
      const st = line.slice(tag.length + 1).split(" ")[0];
      if (st === "OK" || st === "NO" || st === "BAD") return eol + 2;
    }
    i = eol + 2;
  }
  return -1;
}

class ImapClient {
  private sock: tls.TLSSocket | null = null;
  private seq = 0;

  connect(host: string, port: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ host, port, servername: host }, () => {/* greeting handled below */});
      this.sock = sock;
      sock.setTimeout(timeoutMs);
      let buf = Buffer.alloc(0);
      const onData = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        const s = buf.toString("latin1");
        // Greeting is an untagged completion: "* OK ..." / "* PREAUTH ..."
        if (/^\* (OK|PREAUTH)\b/m.test(s)) { cleanup(); resolve(); }
        else if (/^\* (NO|BAD|BYE)\b/m.test(s)) { cleanup(); reject(new Error("imap greeting refused")); }
      };
      const onErr = (e: Error) => { cleanup(); reject(e); };
      const onTimeout = () => { cleanup(); reject(new Error("imap connect timeout")); };
      const onClose = () => { cleanup(); reject(new Error("imap connection closed before greeting")); };
      const cleanup = () => { sock.off("data", onData); sock.off("error", onErr); sock.off("timeout", onTimeout); sock.off("close", onClose); };
      sock.on("data", onData);
      sock.once("error", onErr);
      sock.once("timeout", onTimeout);
      sock.once("close", onClose);
    });
  }

  // Send one tagged command; resolve with the full raw response Buffer.
  cmd(command: string, timeoutMs: number): Promise<Buffer> {
    const sock = this.sock;
    if (!sock) return Promise.reject(new Error("not connected"));
    const tag = "a" + (++this.seq);
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const onData = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (findTagCompletion(buf, tag) !== -1) { cleanup(); resolve(buf); }
      };
      const onErr = (e: Error) => { cleanup(); reject(e); };
      const onTimeout = () => { cleanup(); reject(new Error("imap command timeout")); };
      const onClose = () => { cleanup(); reject(new Error("imap connection closed mid-command")); };
      const cleanup = () => { sock.off("data", onData); sock.off("error", onErr); sock.off("timeout", onTimeout); sock.off("close", onClose); };
      sock.setTimeout(timeoutMs);
      sock.on("data", onData);
      sock.once("error", onErr);
      sock.once("timeout", onTimeout);
      sock.once("close", onClose);
      sock.write(tag + " " + command + "\r\n");
    });
  }

  close(): void {
    try { this.sock?.destroy(); } catch { /* noop */ }
    this.sock = null;
  }
}

function imapQuote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function tagStatus(resp: Buffer, tag: string): "OK" | "NO" | "BAD" | "?" {
  const m = new RegExp("^" + tag + " (OK|NO|BAD)\\b", "m").exec(resp.toString("latin1"));
  return (m?.[1] as any) ?? "?";
}

// Pull every literal payload ({n}\r\n<n bytes>) out of a FETCH response — one per
// fetched message body.
function extractLiterals(resp: Buffer): string[] {
  const s = resp.toString("latin1");
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const eol = s.indexOf("\r\n", i);
    if (eol === -1) break;
    const line = s.slice(i, eol);
    const lit = /\{(\d+)\}$/.exec(line);
    if (lit) {
      const start = eol + 2;
      const len = parseInt(lit[1], 10);
      const end = start + len;
      if (end > s.length) break;
      // Decode this byte range as UTF-8 for correct header/text handling.
      out.push(resp.subarray(Buffer.byteLength(s.slice(0, start), "latin1"), Buffer.byteLength(s.slice(0, end), "latin1")).toString("utf8"));
      i = end;
      continue;
    }
    i = eol + 2;
  }
  return out;
}

// ---- MIME → iCalendar payloads ----------------------------------------------
function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "")              // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

export function findCalendarPayloads(raw: string): string[] {
  const boundaries = new Set<string>();
  for (const m of raw.matchAll(/boundary="?([^";\r\n]+)"?/gi)) boundaries.add(m[1]);
  // Flatten every nesting level by splitting on all declared boundaries.
  let segments = [raw];
  for (const b of boundaries) {
    const next: string[] = [];
    for (const seg of segments) next.push(...seg.split("--" + b));
    segments = next;
  }
  const out: string[] = [];
  for (const seg of segments) {
    const hasCal = /content-type:\s*text\/calendar/i.test(seg) || /\.ics(?:["'\s;])/i.test(seg) || /BEGIN:VCALENDAR/i.test(seg);
    if (!hasCal) continue;
    const sepCrlf = seg.indexOf("\r\n\r\n");
    const sepLf = seg.indexOf("\n\n");
    let headers = "", body = seg;
    if (sepCrlf >= 0) { headers = seg.slice(0, sepCrlf); body = seg.slice(sepCrlf + 4); }
    else if (sepLf >= 0) { headers = seg.slice(0, sepLf); body = seg.slice(sepLf + 2); }
    const cte = (/content-transfer-encoding:\s*([^\r\n]+)/i.exec(headers)?.[1] || "").trim().toLowerCase();
    let decoded = body;
    if (cte === "base64") {
      try { decoded = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("utf8"); } catch { decoded = body; }
    } else if (cte === "quoted-printable") {
      decoded = decodeQuotedPrintable(body);
    }
    const block = /BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i.exec(decoded);
    if (block) out.push(block[0]);
  }
  // Fallback: an inline (single-part) invite with no usable boundary.
  if (out.length === 0) {
    const m = /BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i.exec(raw);
    if (m) out.push(m[0]);
  }
  return out;
}

// ---- iCalendar parse --------------------------------------------------------
function unescapeIcsText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

const LINK_RE = /https?:\/\/[^\s"'<>()\\]*(?:zoom\.us\/[^\s"'<>()\\]+|meet\.google\.com\/[^\s"'<>()\\]+|teams\.microsoft\.com\/[^\s"'<>()\\]+|teams\.live\.com\/[^\s"'<>()\\]+|(?:\.|\/)webex\.com\/[^\s"'<>()\\]+|meetings?\.[^\s"'<>()\\]+)/i;

export function extractMeetingLink(...texts: string[]): string {
  for (const t of texts) {
    if (!t) continue;
    const m = LINK_RE.exec(unescapeIcsText(t));
    if (m) return m[0].replace(/[.,;)\]]+$/, "");
  }
  return "";
}

type IcsProp = { value: string; params: string[] };

// Resolve a wall-clock time in an IANA zone to a UTC Date (no tz-data dep — Intl
// carries the zone tables). Single-pass offset; adequate outside the ~1h/yr DST
// fold ambiguity.
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date | null {
  try {
    const asUtc = Date.UTC(y, mo, d, h, mi, s);
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(asUtc))) parts[p.type] = p.value;
    const hr = parts.hour === "24" ? 0 : Number(parts.hour);
    const tzAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hr, Number(parts.minute), Number(parts.second));
    const offset = tzAsUtc - asUtc; // how far the zone's wall clock leads UTC at that instant
    return new Date(asUtc - offset);
  } catch {
    return null;
  }
}

function parseDt(prop: IcsProp): Date | null {
  const v = prop.value.trim();
  const tzParam = prop.params.find((p) => /^TZID=/i.test(p));
  const tz = tzParam ? tzParam.slice(tzParam.indexOf("=") + 1) : null;
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (m) {
    const [, Y, Mo, D, H, Mi, S, z] = m;
    if (z === "Z") return new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S));
    if (tz) { const r = zonedToUtc(+Y, +Mo - 1, +D, +H, +Mi, +S, tz); if (r) return r; }
    return new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S)); // floating → treat as UTC (deterministic)
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v); // VALUE=DATE (all-day)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0));
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function parseIcs(ics: string): CalEvent[] {
  // RFC5545 line unfolding: a CRLF followed by space/tab continues the prior line.
  const unfolded = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: CalEvent[] = [];
  let props: Record<string, IcsProp[]> | null = null;
  let rawLines: string[] = [];
  let cancelled = false;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { props = {}; rawLines = []; cancelled = false; continue; }
    if (/^END:VEVENT/i.test(line)) {
      if (props && !cancelled) {
        const uid = props.UID?.[0]?.value?.trim() || "";
        const summary = props.SUMMARY?.[0] ? unescapeIcsText(props.SUMMARY[0].value).trim() : "";
        const dt = props.DTSTART?.[0] ? parseDt(props.DTSTART[0]) : null;
        const link = extractMeetingLink(
          props.LOCATION?.[0]?.value || "",
          props.URL?.[0]?.value || "",
          props["X-GOOGLE-CONFERENCE"]?.[0]?.value || "",
          props["X-MICROSOFT-SKYPETEAMSMEETINGURL"]?.[0]?.value || "",
          props.DESCRIPTION?.[0]?.value || "",
          rawLines.join("\n"),
        );
        if (uid && dt) events.push({ externalId: uid, title: summary, link, startAt: dt.toISOString() });
      }
      props = null;
      continue;
    }
    if (!props) continue;
    rawLines.push(line);
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const namePart = line.slice(0, ci);
    const value = line.slice(ci + 1);
    const segs = namePart.split(";");
    const name = segs[0].toUpperCase();
    (props[name] ||= []).push({ value, params: segs.slice(1) });
    if (name === "STATUS" && /CANCELLED/i.test(value)) cancelled = true;
  }
  // METHOD:CANCEL at calendar level cancels the whole thing.
  if (/^METHOD:CANCEL\b/im.test(unfolded)) return [];
  return events;
}

// ---- top-level: fetch + parse the clone mailbox -----------------------------
function twoDigit(n: number): string { return n < 10 ? "0" + n : String(n); }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function imapDate(d: Date): string { return `${twoDigit(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`; }

/**
 * Read UPCOMING meetings from the clone's own mailbox via IMAP. Returns
 * de-duplicated, future-only CalEvent[]. NEVER throws — returns [] on any error.
 */
export async function fetchCloneCalendar(account: MeetingAccount, nowMs: number = Date.now()): Promise<CalEvent[]> {
  const host = imapHost(account.provider, account.email);
  const user = (account.username || account.email || "").trim();
  const pass = account.password || "";
  if (!host || !user || !pass) return [];

  const client = new ImapClient();
  // Hard watchdog: no matter what the socket does (hang, half-open, never
  // emitting error OR close), this call resolves to [] within the budget so a
  // scheduler tick in the always-alive bff can never be wedged.
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<CalEvent[]>((resolve) => {
    watchdog = setTimeout(() => { try { client.close(); } catch { /* noop */ } resolve([]); }, OVERALL_TIMEOUT_MS + 2000);
    watchdog.unref?.();
  });
  try {
    return await Promise.race([run(), guard]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }

  async function run(): Promise<CalEvent[]> {
  const deadline = nowMs + OVERALL_TIMEOUT_MS;
  const remaining = () => Math.max(1000, deadline - Date.now());
  try {
    await client.connect(host, IMAP_PORT, remaining());
    const login = await client.cmd(`LOGIN ${imapQuote(user)} ${imapQuote(pass)}`, remaining());
    if (tagStatus(login, "a1") !== "OK") return [];
    await client.cmd(`SELECT INBOX`, remaining());
    const sinceStr = imapDate(new Date(nowMs - SINCE_DAYS * 86_400_000));
    const searchResp = await client.cmd(`UID SEARCH SINCE ${sinceStr}`, remaining());
    const searchLine = /^\* SEARCH([\d ]*)/im.exec(searchResp.toString("latin1"));
    let uids = searchLine ? searchLine[1].trim().split(/\s+/).filter(Boolean) : [];
    if (uids.length === 0) return [];
    if (uids.length > MAX_MESSAGES) uids = uids.slice(-MAX_MESSAGES); // most recent
    const fetchResp = await client.cmd(`UID FETCH ${uids.join(",")} (BODY.PEEK[])`, remaining());
    const messages = extractLiterals(fetchResp);

    const byUid = new Map<string, CalEvent>();
    for (const msg of messages) {
      for (const ics of findCalendarPayloads(msg)) {
        for (const ev of parseIcs(ics)) {
          if (!ev.link || !ev.startAt) continue;
          if (new Date(ev.startAt).getTime() <= nowMs) continue; // future only
          byUid.set(ev.externalId, ev); // dedupe: later message (=newer update) wins
        }
      }
    }
    return [...byUid.values()];
  } catch {
    return []; // fail-safe: a mailbox/parse problem must never break the scheduler
  } finally {
    try { await client.cmd(`LOGOUT`, 2000).catch(() => {}); } catch { /* noop */ }
    client.close();
  }
  } // end run()
}
