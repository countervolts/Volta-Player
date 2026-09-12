const VERSION_HANDOFF_REQUEST = "volta-version-handoff-request";
const VERSION_HANDOFF_STATE = "volta-version-handoff-state";
const HANDOFF_COMPLETE_KEY = "volta-version-handoff-complete";

const VERSION_HOSTS = new Set([
  "player.ayois.gay",
  "player.voltamusic.xyz",
  "beta-player.ayois.gay",
  "beta-player.voltamusic.xyz",
]);

const alternateVersionOrigin = () => {
  if (!VERSION_HOSTS.has(window.location.hostname)) return "";
  const url = new URL(window.location.href);
  url.hostname = url.hostname.replace("beta-player.", "player.");
  if (url.hostname === window.location.hostname) {
    url.hostname = url.hostname.replace("player.", "beta-player.");
  }
  return url.origin;
};

const readVoltaStorage = (storage: Storage) =>
  Object.fromEntries(
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("volta-")))
      .map((key) => [key, storage.getItem(key) || ""]),
  );

const writeVoltaStorage = (storage: Storage, values: Record<string, string>) => {
  Object.entries(values).forEach(([key, value]) => {
    try {
      storage.setItem(key, value);
    } catch {
      /* Storage is optional and quota-limited. */
    }
  });
};

const sendState = (event: MessageEvent) => {
  const origin = alternateVersionOrigin();
  if (
    event.data?.type !== VERSION_HANDOFF_REQUEST ||
    event.origin !== origin ||
    !event.source
  )
    return;

  (event.source as Window).postMessage(
    {
      type: VERSION_HANDOFF_STATE,
      localStorage: readVoltaStorage(localStorage),
      sessionStorage: readVoltaStorage(sessionStorage),
    },
    event.origin,
  );
};

const receiveState = (event: MessageEvent) => {
  const origin = alternateVersionOrigin();
  if (
    event.data?.type !== VERSION_HANDOFF_STATE ||
    event.origin !== origin ||
    event.source !== window.opener ||
    !event.data.localStorage ||
    !event.data.sessionStorage
  )
    return;

  writeVoltaStorage(localStorage, event.data.localStorage);
  writeVoltaStorage(sessionStorage, event.data.sessionStorage);
  try {
    sessionStorage.setItem(HANDOFF_COMPLETE_KEY, "true");
  } catch {
    /* The reload below is still safe if session storage is unavailable. */
  }
  window.location.reload();
};

window.addEventListener("message", sendState);
window.addEventListener("message", receiveState);

const handoffOrigin = alternateVersionOrigin();
if (
  handoffOrigin &&
  window.opener &&
  !(() => {
    try {
      return sessionStorage.getItem(HANDOFF_COMPLETE_KEY) === "true";
    } catch {
      return false;
    }
  })()
) {
  window.opener.postMessage({ type: VERSION_HANDOFF_REQUEST }, handoffOrigin);
}

export {};
