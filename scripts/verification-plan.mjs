export function verificationScripts({ downstream }) {
  const scripts = ["typecheck", "lint", "test:unit", "test:config", "test:config-consistency", "test:verification-plan"];

  if (downstream) {
    scripts.push("test:publication-scan", "check:downstream-drift");
  } else {
    scripts.push("test:public-docs", "test:publication-scan", "scan:publication");
  }

  scripts.push("test:downstream-contract", "test:downstream-drift", "test:downstream-release-plan", "test:bootstrap-command", "test:supabase-boundary", "test:naming", "build", "test:static");
  return scripts;
}
