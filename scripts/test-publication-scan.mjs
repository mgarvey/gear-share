import assert from "node:assert/strict";
import policy from "../config/publication-policy.json" with { type: "json" };
import { scanPublicationBytes, scanPublicationEntry, scanPublicationText } from "./publication-scan.mjs";

const safe = "Use https://project-example.supabase.co with member@example.test from /tmp/gear-share.";
assert.deepEqual(scanPublicationText("docs/setup.md", safe, policy), []);

for (const [id, fixture] of [
  ["PUBSCAN-SECRET", `AWS_ACCESS_KEY_ID=${"AKIA"}${"1234567890ABCDEF"}`],
  ["PUBSCAN-PERSONAL-PATH", `clone /${"Users"}/${"privateperson"}/Code/gear-share`],
  ["PUBSCAN-CONTACT", `contact private-person@${"real-domain"}.org`],
  ["PUBSCAN-HOSTED-ID", `https://${"mbmmfgivh" + "qzhjyneyelu"}.supabase.co`],
  ["PUBSCAN-PROVIDER-ID", `${"arn"}:aws:ses:us-east-1:${"210987" + "654321"}:identity/example.org`],
  ["PUBSCAN-MEMBER-DATA", `member@${"private-community"}.org`],
]) {
  assert(scanPublicationText("src/unsafe.ts", fixture, policy).some((finding) => finding.id === id), `${id} fixture must fail`);
}

assert(scanPublicationBytes("private/archive.zip", Buffer.from([0, 1, 2]), policy).some((finding) => finding.id === "PUBSCAN-BINARY"));
assert(scanPublicationBytes("public/favicon.ico", Buffer.from([0, 1, 2]), policy).some((finding) => finding.id === "PUBSCAN-BINARY"));
assert(scanPublicationEntry("docs/external-link", Buffer.alloc(0), policy, { symbolicLink: true }).some((finding) => finding.id === "PUBSCAN-SYMLINK"));
console.log("Gear Share publication-scan fixtures OK.");
