const RECOVERED_CHUNK_KEY = "gear-share:recovered-chunk";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem">;

export function handleStaleChunkLoad(
  event: Event & { payload?: unknown },
  storage: RecoveryStorage,
  reload: () => void,
) {
  const fingerprint =
    event.payload instanceof Error
      ? event.payload.message
      : String(event.payload ?? "unknown dynamic import");

  try {
    if (storage.getItem(RECOVERED_CHUNK_KEY) === fingerprint) return false;
    storage.setItem(RECOVERED_CHUNK_KEY, fingerprint);
  } catch {
    // Without a durable guard, let the error boundary offer a manual refresh.
    return false;
  }

  event.preventDefault();
  reload();
  return true;
}

export function installStaleChunkRecovery(target: Window = window) {
  target.addEventListener("vite:preloadError", (event) => {
    handleStaleChunkLoad(
      event as Event & { payload?: unknown },
      target.sessionStorage,
      () => target.location.reload(),
    );
  });
}
