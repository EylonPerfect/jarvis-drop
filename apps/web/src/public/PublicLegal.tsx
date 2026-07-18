import { Icon, type Nav, PublicNav, PublicFooter, PublicShell } from "./PublicChrome";

// ============================================================
// After Human — public legal pages (Terms of Service + Privacy
// Policy). Rendered by PublicSite for #/terms and #/privacy,
// mirroring how PublicLanding / PublicAuth are routed. Uses the
// shared public chrome (nav pill + footer) so nothing product-
// side is touched and both docs stay linkable / shareable.
//
// IMPORTANT: this is PLACEHOLDER legal copy drafted for the
// product's actual shape (an AI teammate that joins calls with
// disclosure, processes recordings/transcripts, and bills via
// Lemon Squeezy as merchant of record). It has NOT been reviewed
// by counsel — see the banner at the top of each doc. Do not
// treat as final terms until a lawyer has signed off.
// ============================================================

const COMPANY = "After Human";
const CONTACT = "legal@afterhuman.ai";
const PRIVACY_CONTACT = "privacy@afterhuman.ai";
const EFFECTIVE = "Effective date: on publication (placeholder — set at launch)";

type Section = { h: string; body: string[] };

const TERMS: Section[] = [
  {
    h: "1. Agreement to these Terms",
    body: [
      `These Terms of Service ("Terms") are a binding agreement between you and ${COMPANY} ("we", "us") governing your access to and use of the ${COMPANY} platform, websites, and related services (the "Service"). By creating an account, clicking "Create account", or using the Service, you agree to these Terms. If you are entering into these Terms on behalf of a company or other organization, you represent that you have authority to bind that entity, and "you" refers to that entity.`,
    ],
  },
  {
    h: "2. What the Service does",
    body: [
      `${COMPANY} builds AI "clones" of your team members from recordings of their calls and lets those clones run live video calls (for example, sales or customer-success demos) on your behalf. A clone joins a call as an AI teammate, speaks in a synthesized voice, and can drive a screen to demonstrate software.`,
      `Clones must clear an internal readiness score before they are eligible to run a live call. The readiness score is a quality signal, not a guarantee of outcome or accuracy. You are responsible for deciding when and where to deploy a clone.`,
    ],
  },
  {
    h: "3. Accounts and eligibility",
    body: [
      `You must be at least 18 years old and able to form a binding contract to use the Service. You are responsible for the accuracy of your account information, for maintaining the confidentiality of your credentials, and for all activity under your account. Notify us promptly of any unauthorized use.`,
    ],
  },
  {
    h: "4. Your responsibilities",
    body: [
      `You are solely responsible for how you configure and deploy clones, including which systems, accounts, and environments you connect them to and what actions you permit them to take. The clone operates with the autonomy you grant it; responsibility for where it is pointed and what it does rests with you.`,
      `You represent and warrant that you have the right to automate, and to authorize us to automate on your behalf, any third-party account, product, or system you connect to the Service, and that doing so does not violate any agreement between you and that third party.`,
      `You will use the Service only for lawful purposes and in compliance with all applicable laws, including laws governing call recording, consent, marketing, telecommunications, biometric data, and consumer protection in every jurisdiction where you or your call participants are located.`,
    ],
  },
  {
    h: "5. AI disclosure and recording consent",
    body: [
      `The Service is designed to disclose to call participants that they are interacting with an AI. You agree not to disable, obscure, or circumvent this disclosure, and to obtain any additional notice or consent that applicable law requires for AI interaction or call recording.`,
      `You are responsible for obtaining all consents required to record, transcribe, and process calls and to create a voice or likeness clone of any individual, including your own team members. Recording or uploading a voice sample of a person constitutes your representation that you have that person's consent.`,
    ],
  },
  {
    h: "6. Acceptable use",
    body: [
      `You will not use the Service to: impersonate a person without their consent; deceive participants about the AI nature of the interaction where disclosure is required; engage in fraud, harassment, or deceptive or unfair practices; violate the rights of others; or attempt to defeat platform quality, safety, or security controls. We may suspend clones or accounts that create risk to participants, third parties, or the Service.`,
    ],
  },
  {
    h: "7. Fees, billing, and merchant of record",
    body: [
      `The Service offers a free tier (build and rehearse a clone, with capped rehearsal usage) and paid access required to take a clone live. Pricing is shown in the product and on our pricing page and may change on notice.`,
      `Payments are processed by Lemon Squeezy, which acts as the merchant of record for purchases made through the Service. Your purchase is therefore also subject to Lemon Squeezy's terms and privacy policy, and Lemon Squeezy (not ${COMPANY}) is the seller of record responsible for billing, tax collection, and payment handling. Fees are non-refundable except where required by law or expressly stated.`,
    ],
  },
  {
    h: "8. Your content and intellectual property",
    body: [
      `As between you and us, you retain all rights to the recordings, transcripts, voice samples, and other materials you provide ("Customer Content") and to the clones built from them. You grant us a limited license to host and process Customer Content solely to provide, secure, and improve the Service as described in our Privacy Policy. We retain all rights in the Service itself, including our software, models, and platform.`,
    ],
  },
  {
    h: "9. Third-party services",
    body: [
      `The Service relies on third-party providers (for example, for voice synthesis, model inference, virtual desktops, analytics, video conferencing, and payments). Your use of the Service may be subject to those providers' terms, and we are not responsible for third-party services outside our control.`,
    ],
  },
  {
    h: "10. Disclaimers",
    body: [
      `The Service is provided "as is" and "as available". AI systems can produce inaccurate, incomplete, or unexpected output; a clone may misstate facts, misunderstand a participant, or fail to complete a task. We disclaim all warranties to the fullest extent permitted by law, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that the readiness score predicts any particular result.`,
    ],
  },
  {
    h: "11. Limitation of liability",
    body: [
      `To the fullest extent permitted by law, ${COMPANY} will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any lost profits, revenues, data, or goodwill, arising out of or related to the Service. Our total liability for any claim relating to the Service will not exceed the amounts you paid to us for the Service in the twelve months before the event giving rise to the claim.`,
    ],
  },
  {
    h: "12. Indemnification",
    body: [
      `You will indemnify and hold harmless ${COMPANY} from claims, damages, and expenses arising out of your Customer Content, your deployment of clones, your connected systems and accounts, or your breach of these Terms or of applicable law, including laws on recording, consent, or AI disclosure.`,
    ],
  },
  {
    h: "13. Term and termination",
    body: [
      `You may stop using the Service at any time. We may suspend or terminate access if you breach these Terms or create risk to the Service or others. On termination, your right to use the Service ends; provisions that by their nature should survive (including ownership, disclaimers, limitation of liability, and indemnity) will survive.`,
    ],
  },
  {
    h: "14. Changes to these Terms",
    body: [
      `We may update these Terms from time to time. If we make material changes we will provide reasonable notice, for example by posting the updated Terms with a new effective date. Your continued use of the Service after changes take effect constitutes acceptance.`,
    ],
  },
  {
    h: "15. Governing law and contact",
    body: [
      `These Terms are governed by the laws of the jurisdiction stated at launch (placeholder — to be set with counsel), without regard to conflict-of-laws rules.`,
      `Questions about these Terms can be sent to ${CONTACT}.`,
    ],
  },
];

const PRIVACY: Section[] = [
  {
    h: "1. Scope",
    body: [
      `This Privacy Policy explains how ${COMPANY} ("we", "us") collects, uses, and shares personal information when you use our platform and websites (the "Service"). It applies to information about account holders, the team members whose calls are cloned, and the participants on calls that clones join or that you upload.`,
    ],
  },
  {
    h: "2. Information we collect",
    body: [
      `Account information: name, work email, company, password (stored hashed), and billing status.`,
      `Call recordings and transcripts: audio, video, transcripts, and derived metadata from the calls you upload or that a clone joins, which we process to build and operate clones.`,
      `Voice and likeness data: voice samples and models used to synthesize a clone's voice. This may include voice characteristics that are treated as sensitive or biometric data under some laws.`,
      `Usage and device data: product events, log data, and analytics collected to operate, secure, and improve the Service.`,
    ],
  },
  {
    h: "3. How we use information",
    body: [
      `We use personal information to: build and operate clones and compute readiness; provide, secure, and support the Service; process payments; communicate with you; detect and prevent abuse or fraud; comply with law; and improve the Service. We do not sell personal information.`,
    ],
  },
  {
    h: "4. Voice cloning and sensitive data",
    body: [
      `Creating a clone involves generating a synthetic voice and behavioral profile of an individual from their call recordings and voice samples. We process this data to provide the Service at your direction. You are responsible for obtaining the consent of any individual before submitting their recordings or voice, and some jurisdictions require specific consent for biometric or voice data.`,
    ],
  },
  {
    h: "5. Call recording, transcripts, and AI disclosure",
    body: [
      `When a clone joins a live call, the Service is designed to disclose that participants are interacting with an AI. Calls may be recorded and transcribed so the Service can operate and so you can review them. You are responsible for providing any recording or AI-interaction notices that participants are entitled to under applicable law.`,
    ],
  },
  {
    h: "6. Service providers and sub-processors",
    body: [
      `We share personal information with vendors that help us run the Service, under agreements that limit their use of the data. These include providers of voice synthesis, AI model inference, virtual desktop/compute, video conferencing, product analytics, hosting, and payments. Payments are handled by Lemon Squeezy as merchant of record; Lemon Squeezy processes your billing information under its own privacy policy.`,
    ],
  },
  {
    h: "7. How we share information",
    body: [
      `We share information with the sub-processors above, within your organization's account, when required by law or to protect rights and safety, and in connection with a business transfer (such as a merger or acquisition). We do not sell personal information and do not share it for cross-context behavioral advertising.`,
    ],
  },
  {
    h: "8. Data retention",
    body: [
      `We retain personal information for as long as needed to provide the Service, then delete or de-identify it in line with our retention practices, unless a longer period is required by law. You can request deletion of Customer Content and clones as described below.`,
    ],
  },
  {
    h: "9. Security",
    body: [
      `We use administrative, technical, and organizational measures designed to protect personal information. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.`,
    ],
  },
  {
    h: "10. Your rights",
    body: [
      `Depending on your location, you may have rights to access, correct, delete, export, or restrict processing of your personal information, and to withdraw consent. To exercise these rights, contact us at ${PRIVACY_CONTACT}. Individuals whose voice or calls were cloned may direct requests to the customer that controls that data, or to us, and we will route them appropriately.`,
    ],
  },
  {
    h: "11. International transfers and data location",
    body: [
      `The Service currently operates in a single region, disclosed at launch. Where personal information is transferred across borders, we use appropriate safeguards as required by applicable law.`,
    ],
  },
  {
    h: "12. Children",
    body: [
      `The Service is not directed to children and is intended for business use by adults. We do not knowingly collect personal information from children.`,
    ],
  },
  {
    h: "13. Changes and contact",
    body: [
      `We may update this Privacy Policy from time to time and will post the updated version with a new effective date. For privacy questions or requests, contact ${PRIVACY_CONTACT}.`,
    ],
  },
];

function CounselBanner() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "14px 16px",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--card)",
        marginBottom: 28,
      }}
    >
      <Icon name="gavel" style={{ fontSize: 20, color: "#FF0660", marginTop: 1 }} />
      <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink2)" }}>
        <b style={{ color: "var(--ink1)" }}>Draft — review with counsel before launch.</b>{" "}
        This is placeholder legal copy written for the product's actual shape. It has not been
        reviewed by a lawyer and is not final. Do not rely on it as binding terms until counsel has
        signed off.
      </div>
    </div>
  );
}

export default function PublicLegal({ nav, doc }: { nav: Nav; doc: "terms" | "privacy" }) {
  const isTerms = doc === "terms";
  const title = isTerms ? "Terms of Service" : "Privacy Policy";
  const sections = isTerms ? TERMS : PRIVACY;

  return (
    <PublicShell theme={nav.theme}>
      <PublicNav nav={nav} active="landing" />
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 24px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <button
            onClick={() => nav.go("#/")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              height: 32,
              padding: "0 10px 0 6px",
              borderRadius: 9999,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--ink2)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Icon name="chevron_left" style={{ fontSize: 18 }} />
            Home
          </button>
        </div>
        <h1 style={{ margin: "6px 0 4px", fontSize: 34, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--ink3)" }}>
          {EFFECTIVE}
          {"  ·  "}
          <a
            href={isTerms ? "#/privacy" : "#/terms"}
            onClick={(e) => { e.preventDefault(); nav.go(isTerms ? "#/privacy" : "#/terms"); }}
            style={{ color: "#FF0660", fontWeight: 600 }}
          >
            {isTerms ? "Privacy Policy" : "Terms of Service"}
          </a>
        </p>

        <CounselBanner />

        {sections.map((s) => (
          <section key={s.h} style={{ marginBottom: 22 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: "var(--ink1)" }}>{s.h}</h2>
            {s.body.map((p, i) => (
              <p key={i} style={{ margin: "0 0 10px", fontSize: 14.5, lineHeight: 1.62, color: "var(--ink2)" }}>{p}</p>
            ))}
          </section>
        ))}

        <div style={{ marginTop: 30, paddingTop: 18, borderTop: "1px solid var(--divider)", fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.55 }}>
          This document is provided for product-development purposes and is not legal advice. Placeholder
          contact addresses and jurisdiction to be finalized with counsel before launch.
        </div>
      </div>
      <PublicFooter nav={nav} />
    </PublicShell>
  );
}
