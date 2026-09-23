const LOOPBACK = /^(localhost|127(?:\.[0-9]{1,3}){3}|\[::1\])$/;
const UPSTREAM_HOSTS = new Set(["communitysupplies.org", "www.communitysupplies.org"]);

function isDeniedHost(hostname: string) {
  return UPSTREAM_HOSTS.has(hostname) || hostname.endsWith(".lovable.app");
}

export function configuredPublicOrigin() {
  const supplied = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim();
  if (supplied) {
    const parsed = new URL(supplied);
    const secure = parsed.protocol === "https:";
    const loopbackDevelopment = import.meta.env.DEV && parsed.protocol === "http:" && LOOPBACK.test(parsed.hostname);
    if ((!secure && !loopbackDevelopment) || isDeniedHost(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("VITE_PUBLIC_APP_ORIGIN must be an approved HTTPS origin without credentials, path, query, or fragment.");
    }
    return parsed.origin;
  }
  if (import.meta.env.DEV && LOOPBACK.test(window.location.hostname)) return window.location.origin;
  throw new Error("VITE_PUBLIC_APP_ORIGIN is required for account recovery.");
}

export function configuredJoinUrl() {
  return `${configuredPublicOrigin()}/join`;
}

export function configuredPrivacyContactUrl() {
  const parsed = new URL(import.meta.env.VITE_PRIVACY_CONTACT_URL);
  if (parsed.protocol !== "https:" || isDeniedHost(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("VITE_PRIVACY_CONTACT_URL must be an approved public HTTPS route without credentials, query, or fragment.");
  }
  return parsed.href;
}

export function configuredBackupRetentionDays() {
  const supplied = import.meta.env.VITE_BACKUP_RETENTION_DAYS;
  if (!/^[1-9][0-9]{0,2}$/.test(supplied) || Number(supplied) > 365) {
    throw new Error("VITE_BACKUP_RETENTION_DAYS must be an exact maximum from 1 through 365 days.");
  }
  return Number(supplied);
}

export function isDevelopmentInviteUrl(url: string) {
  const parsed = new URL(url);
  return parsed.protocol === "http:" && LOOPBACK.test(parsed.hostname);
}
