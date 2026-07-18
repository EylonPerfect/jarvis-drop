# Data Processing Agreement

**Between AfterHuman ("Processor") and [CUSTOMER LEGAL NAME] ("Controller")**

Effective date: [DATE]

This Data Processing Agreement ("DPA") forms part of the Agreement between AfterHuman and the Controller for the provision of the AfterHuman platform (the "Service"). It reflects the parties' agreement on the processing of personal data.

## 1. Definitions

- **Personal Data** — any information relating to an identified or identifiable natural person processed on the Controller's behalf.
- **Processing** — any operation performed on Personal Data, whether automated or not.
- **Subprocessor** — any third party engaged by the Processor to process Personal Data.
- **Customer Data** — call recordings, transcripts, voice samples, connected-system credentials, and derived clone artifacts supplied by or generated for the Controller.

## 2. Roles and scope

The Controller is the controller of Customer Data. AfterHuman is the processor. AfterHuman processes Customer Data only to provide the Service, only on documented instructions from the Controller, and never for its own purposes.

## 3. Nature and purpose of processing

AfterHuman clones a designated representative into a digital worker that joins live calls, runs demonstrations, and performs follow-up on the Controller's behalf. Processing includes: extracting a persona and voice from supplied recordings, generating speech, running the clone in isolated sandboxes, and operating connected systems the Controller authorizes.

## 4. Subprocessors

The Controller authorizes the following subprocessors. AfterHuman maintains a signed data-processing agreement with each and will give notice before adding or replacing a subprocessor so the Controller may object.

| Subprocessor | Purpose | Data processed |
| --- | --- | --- |
| OpenAI | Language and reasoning models | Call context, transcripts, prompts |
| ElevenLabs | Voice cloning and speech synthesis | Rep voice sample, generated speech |
| e2b | Isolated cloud sandboxes | Live-call session artifacts (ephemeral) |
| Hostinger | Application and database hosting | All platform data at rest |

## 5. Security measures

AfterHuman maintains technical and organizational measures appropriate to the risk, including:

- Encryption of Customer Data at rest.
- Per-organization isolation of clones, sources, and connected systems.
- Server-side storage of secrets; credentials are never returned to the browser.
- Audit logging of privileged and super-admin actions.
- Access to the administrative control plane gated by an access key, with MFA and/or IP allowlisting enabled before production customer data is onboarded, new-IP login alerts, and one-click lockdown.

## 6. AI disclosure

On every live call, regardless of join method, the digital worker discloses that it is an AI. It will not invent figures it was not given and will not finalize or sign a binding contract by voice.

## 7. Retention and deletion

AfterHuman retains Customer Data while the associated clone is active and purges it on deletion. The Controller may configure a hard time-box for auto-purge. On deletion of an organization, clone, or call, AfterHuman performs a hard cascade purge: database rows, stored files, and sandbox artifacts are deleted, the cloned voice is revoked with the voice subprocessor, and stored product credentials are wiped. Deletion is not soft-delete.

## 8. Data subject requests

AfterHuman will, taking into account the nature of the processing, assist the Controller by appropriate technical and organizational measures in responding to requests to exercise data-subject rights (access, rectification, erasure, portability, objection).

## 9. Personal data breach

AfterHuman will notify the Controller without undue delay and in any event within 72 hours of becoming aware of a personal data breach affecting Customer Data, and will provide information reasonably required for the Controller to meet its own notification obligations. Each Controller designates a security contact for this purpose.

## 10. International transfers and location

The Service operates from a single disclosed region at launch. Where required, transfers are governed by an appropriate transfer mechanism. EU data residency is available as an enterprise option.

## 11. Audits

AfterHuman will make available information reasonably necessary to demonstrate compliance with this DPA. SOC 2 attestation is on the roadmap; until then AfterHuman responds to security questionnaires and provides its security documentation.

## 12. Return and deletion on termination

On termination of the Agreement, AfterHuman deletes Customer Data in accordance with Section 7 unless retention is required by law.

## 13. Liability and governing law

This DPA is governed by the law and jurisdiction set out in the Agreement. In case of conflict between this DPA and the Agreement on data-protection matters, this DPA controls.

---

**AfterHuman**
Signature: ______________________  Name: ______________________  Date: __________

**[CUSTOMER LEGAL NAME]**
Signature: ______________________  Name: ______________________  Date: __________
