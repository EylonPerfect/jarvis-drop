import { config } from "../config.js";

// ============================================================================
// lib/email.ts — transactional email via Resend. The ONLY place that talks to
// the provider's HTTP API (swap the URL/headers to move to Postmark/SES). Inert
// (returns false) until RESEND_API_KEY + EMAIL_FROM are set. Never throws.
// ============================================================================

export function emailConfigured(): boolean {
  return !!config.email.apiKey && !!config.email.from;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  if (!emailConfigured() || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.email.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.email.from, to, subject, html, ...(text ? { text } : {}) }),
    });
    return r.ok;
  } catch { return false; }
}

const SEV_COLOR: Record<string, string> = { info: "#00BBFF", success: "#0E8A4F", warning: "#B8890A", critical: "#FF0660" };

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Branded, email-safe HTML (tables + inline styles + system fonts) matching the
// AfterHuman email design: dark header, severity accent bar, pink CTA, footer.
export function renderNotificationEmail(n: {
  title: string; body: string; ctaLabel?: string; ctaUrl?: string; severity?: string;
}): { html: string; text: string } {
  const accent = SEV_COLOR[n.severity ?? "info"] ?? "#00BBFF";
  const cta = n.ctaLabel && n.ctaUrl
    ? `<tr><td style="padding:20px 0 2px;"><a href="${esc(n.ctaUrl)}" style="display:inline-block;background:#FF0660;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:9999px;">${esc(n.ctaLabel)}</a></td></tr>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EDEDF2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEDF2;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#04042A;padding:18px 28px;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-.01em;">AfterHuman</td></tr>
        <tr><td style="padding:28px 28px 30px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:5px;background:${accent};border-radius:4px;">&nbsp;</td>
            <td style="padding-left:14px;"><div style="font-size:19px;font-weight:800;color:#000040;letter-spacing:-.01em;line-height:1.25;">${esc(n.title)}</div></td>
          </tr></table>
          <div style="font-size:14px;color:rgba(0,0,64,.65);line-height:1.6;margin:14px 0 0;">${esc(n.body)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0">${cta}</table>
          <div style="margin-top:24px;padding-top:16px;border-top:1px solid #EBEBEE;font-size:11px;color:rgba(0,0,64,.4);line-height:1.6;">You are receiving this because you manage clones on AfterHuman. You can change what emails you get in your workspace settings.</div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  const text = `${n.title}\n\n${n.body}${n.ctaUrl ? `\n\n${n.ctaLabel ?? "Open"}: ${n.ctaUrl}` : ""}\n\n— AfterHuman`;
  return { html, text };
}
