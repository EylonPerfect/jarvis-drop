// PHASE 2 — credential encryption self-test. Run with a key set:
//   CRED_ENC_KEY=... node --import tsx apps/bff/test/crypto.test.ts
// Proves: ciphertext is not plaintext, roundtrips, and is bound per-org+key
// (a ciphertext cannot be decrypted with another org's or another key's AAD).
import { encryptSecret, decryptSecret, credAad, isEncrypted, encryptionEnabled } from "../src/lib/cryptoCreds.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error("FAIL: " + msg);
}

assert(encryptionEnabled(), "CRED_ENC_KEY must be set for this test");
const org = "org_A", key = "demo_login:ag_1", pw = "hunter2-secret";
const enc = encryptSecret(pw, credAad(org, key));
assert(isEncrypted(enc), "output is prefixed ciphertext");
assert(!enc.includes(pw), "plaintext must NOT appear in ciphertext");
assert(decryptSecret(enc, credAad(org, key)) === pw, "roundtrip decrypt returns plaintext");

let rejected = false;
try { decryptSecret(enc, credAad("org_B", key)); } catch { rejected = true; }
assert(rejected, "cross-ORG AAD must fail to decrypt (per-org binding)");

rejected = false;
try { decryptSecret(enc, credAad(org, "demo_login:ag_2")); } catch { rejected = true; }
assert(rejected, "cross-KEY AAD must fail to decrypt");

assert(decryptSecret("plain-legacy", credAad(org, key)) === "plain-legacy", "legacy plaintext passes through");

console.log("CRYPTO TEST PASSED — encrypt/decrypt roundtrip + per-org+key AAD binding verified.");
