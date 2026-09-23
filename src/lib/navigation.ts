export type ReturnState = { returnTo?: unknown } | null;

const SAFE_GEAR_SHARE_DESTINATION = /^(?:\/(?:catalog|my-gear|inventory|administration|loans|wanted)|\/gear\/[^/?#]+)(?:\?[^#]*)?$/;

export function safeReturnPath(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_GEAR_SHARE_DESTINATION.test(value) ? value : fallback;
}
