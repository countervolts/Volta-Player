export type InfinitePlayMode = "algorithm" | "random";
export type ShareProvider = "apple-music" | "spotify";
export type PinKind = "album" | "artist" | "playlist";
export type Pin = {
  kind: PinKind;
  id: string;
  name: string;
  /** Optional artwork carried forward with newer pins; older pins still load. */
  coverArt?: string;
  imageUrl?: string;
};
export type SavedAccount = {
  server: string;
  username: string;
  auth: { salt: string; token: string };
};
export type LoginDraft = { server: string; username: string };
export type StoredCredentials = {
  server: string;
  username: string;
  auth: { salt: string; token: string };
};

export const safeRead = (storage: Storage, key: string) => {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
};
export const safeWrite = (storage: Storage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
};
export const safeRemove = (storage: Storage, key: string) => {
  try {
    storage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
};

export const LOCAL_FAVORITES_KEY = "volta-local-favorites";
export const LOCAL_ALBUM_FAVORITES_KEY = "volta-local-album-favorites";
export const LOCAL_ARTIST_FAVORITES_KEY = "volta-local-artist-favorites";
export const readLocalFavoriteSet = (
  storageKey: string,
  prefix: string,
): Record<string, boolean> => {
  try {
    const value = JSON.parse(safeRead(localStorage, storageKey));
    return value && typeof value === "object"
      ? (Object.fromEntries(
          Object.entries(value)
            .filter(([key, item]) => key.startsWith(prefix) && item === true)
            .map(([key]) => [key, true]),
        ) as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
};
export const writeLocalFavoriteSet = (
  storageKey: string,
  prefix: string,
  map: Record<string, boolean>,
) => {
  safeWrite(
    localStorage,
    storageKey,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(map).filter(
          ([key, value]) => key.startsWith(prefix) && value,
        ),
      ),
    ),
  );
};
export const readLocalFavorites = () =>
  readLocalFavoriteSet(LOCAL_FAVORITES_KEY, "local:");

export const REMEMBERED_CREDENTIALS_KEY = "volta-remembered-credentials";
export const SESSION_CREDENTIALS_KEY = "volta-session-credentials";
export const INTERFACE_SCALE_KEY = "volta-interface-scale";
export const EXTERNAL_LYRICS_KEY = "volta-external-lyrics";
export const LYRICS_BLUR_KEY = "volta-lyrics-blur";
export const INFINITE_PLAY_COUNT_KEY = "volta-infinite-play-count";
export const INFINITE_PLAY_MODE_KEY = "volta-infinite-play-mode";
export const INFINITE_PLAY_ENABLED_KEY = "volta-infinite-play-enabled";
export const LISTENING_HISTORY_ENABLED_KEY = "volta-listening-history-enabled";
export const LISTENING_HISTORY_PERSIST_KEY = "volta-listening-history-persist";
export const CROSSFADE_KEY = "volta-crossfade-seconds";
export const VOLUME_SCROLL_STEP_KEY = "volta-volume-scroll-step";
export const VOLUME_SHIFT_SCROLL_STEP_KEY = "volta-volume-shift-scroll-step";
/**
 * Song transition mode. `automix` plans a per-transition blend from tempo and
 * key; `crossfade` uses the fixed `CROSSFADE_KEY` duration; `off` is gapless.
 */
export const TRANSITION_MODE_KEY = "volta-transition-mode";
export type TransitionMode = "off" | "crossfade" | "automix";
export const readTransitionMode = (): TransitionMode => {
  const value = safeRead(localStorage, TRANSITION_MODE_KEY);
  if (value === "automix" || value === "crossfade" || value === "off")
    return value;
  // A previously configured crossfade keeps working after this setting ships.
  const seconds = Number(safeRead(localStorage, CROSSFADE_KEY));
  return Number.isFinite(seconds) && seconds > 0 ? "crossfade" : "off";
};
export const NORMALIZATION_KEY = "volta-normalization";
export const PINS_KEY = "volta-pins";
export const ACCOUNTS_KEY = "volta-accounts";
export const LOGIN_DRAFT_KEY = "volta-login-draft";
export const LOCAL_SOURCE_MODE_KEY = "volta-source-mode";
export const SEARCH_HISTORY_KEY = "volta-search-history";
export const SHARE_PROVIDER_KEY = "volta-share-provider";
export const FRAME_MONITOR_KEY = "volta-frame-monitor";
export const REWARD_WINDOW_MS = 6 * 60 * 60 * 1000;

export const readShareProvider = (): ShareProvider =>
  safeRead(localStorage, SHARE_PROVIDER_KEY) === "spotify"
    ? "spotify"
    : "apple-music";

export const pinsStorageKey = (server: string, username: string) =>
  `${PINS_KEY}:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;
export const readPins = (key: string): Pin[] => {
  try {
    const value = JSON.parse(safeRead(localStorage, key));
    return Array.isArray(value)
      ? value
          .filter(
            (pin): pin is Pin =>
              pin &&
              typeof pin.id === "string" &&
              typeof pin.name === "string" &&
              ["album", "artist", "playlist"].includes(pin.kind),
          )
          .map((pin) => ({
            ...pin,
            coverArt: typeof pin.coverArt === "string" ? pin.coverArt : undefined,
            imageUrl: typeof pin.imageUrl === "string" ? pin.imageUrl : undefined,
          }))
      : [];
  } catch {
    return [];
  }
};
export const pinKey = (pin: Pin) => `${pin.kind}:${pin.id}`;
export const readAccounts = (): SavedAccount[] => {
  try {
    const value = JSON.parse(safeRead(localStorage, ACCOUNTS_KEY));
    return Array.isArray(value)
      ? value.filter(
          (account): account is SavedAccount =>
            account &&
            typeof account.server === "string" &&
            typeof account.username === "string" &&
            typeof account.auth?.salt === "string" &&
            typeof account.auth?.token === "string" &&
            Boolean(account.auth.salt) &&
            Boolean(account.auth.token),
        )
      : [];
  } catch {
    return [];
  }
};
export const writeAccounts = (accounts: SavedAccount[]) => {
  safeWrite(localStorage, ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, 12)));
};
export const accountKey = (account: { server: string; username: string }) =>
  `${account.server}\u001f${account.username}`;
export const clampInterfaceScale = (value: number) =>
  Math.min(150, Math.max(70, Math.round(value)));
export const readInterfaceScale = () => {
  const value = Number(safeRead(localStorage, INTERFACE_SCALE_KEY));
  return Number.isFinite(value) && value >= 70 && value <= 150
    ? clampInterfaceScale(value)
    : 100;
};
export const readLoginDraft = (): LoginDraft => {
  try {
    const value = JSON.parse(
      safeRead(sessionStorage, LOGIN_DRAFT_KEY),
    ) as Partial<LoginDraft>;
    const draft = {
      server: typeof value.server === "string" ? value.server : "",
      username: typeof value.username === "string" ? value.username : "",
    };
    safeWrite(sessionStorage, LOGIN_DRAFT_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    safeRemove(sessionStorage, LOGIN_DRAFT_KEY);
    return { server: "", username: "" };
  }
};
export const readStoredCredentials = (
  storage: Storage,
  key: string,
): StoredCredentials | null => {
  try {
    const raw = safeRead(storage, key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredCredentials>;
    if (
      typeof value.server !== "string" ||
      typeof value.username !== "string" ||
      typeof value.auth?.salt !== "string" ||
      typeof value.auth.token !== "string" ||
      !value.auth.salt ||
      !value.auth.token
    )
      return null;
    return {
      server: value.server,
      username: value.username,
      auth: { salt: value.auth.salt, token: value.auth.token },
    };
  } catch {
    return null;
  }
};
export const readRememberedCredentials = () =>
  readStoredCredentials(localStorage, REMEMBERED_CREDENTIALS_KEY);
export const readSessionCredentials = () =>
  readStoredCredentials(sessionStorage, SESSION_CREDENTIALS_KEY);
export const libraryPathKey = (server: string, username: string, suffix: string) =>
  `volta-private-path:${encodeURIComponent(server)}:${encodeURIComponent(username)}:${suffix}`;
export const localLibraryPathKey = (suffix: string) =>
  libraryPathKey("local", "local-library", suffix);
export const lastPlayedSongKey = (server: string, username: string) =>
  `volta-last-played:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;
export const volumeKey = (server: string, username: string) =>
  `volta-volume:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;
export const localPlaybackKey = (directoryName: string) =>
  `volta-local-last-played:${encodeURIComponent(directoryName)}`;
export const localVolumeKey = (directoryName: string) =>
  `volta-local-volume:${encodeURIComponent(directoryName)}`;
