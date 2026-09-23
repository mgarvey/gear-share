import assert from "node:assert/strict";
import { verificationScripts } from "./verification-plan.mjs";

const publicScripts = verificationScripts({ downstream: false });
const downstreamScripts = verificationScripts({ downstream: true });

assert(publicScripts.includes("test:public-docs"));
assert(publicScripts.includes("scan:publication"));
assert(!publicScripts.includes("check:downstream-drift"));

assert(!downstreamScripts.includes("test:public-docs"));
assert(!downstreamScripts.includes("scan:publication"));
assert(downstreamScripts.includes("test:publication-scan"));
assert(downstreamScripts.includes("check:downstream-drift"));

console.log("Gear Share public/downstream verification plans OK.");
