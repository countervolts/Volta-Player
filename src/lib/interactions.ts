import { daypartForHour, type ListeningDaypart } from "./listening-history";

/**
 * First-party engagement tracking.
 *
 * Playback events answer "what did they hear". This module answers the wider
 * question of "what did they *do*": which album pages they opened, what they
 * favorited, queued, searched for, muted, and which recommendation they acted
 * on. Those explicit actions are far more informative than a play alone, and
 * they let the recommender distinguish curiosity from genuine taste.
 *
 * Everything is stored on the device under a per-account key. No engagement
 * ever leaves the browser.
 */

export type EngagementKind =
  | "album-view"
  | "artist-view"
  | "genre-view"
  | "favorite-add"
  | "favorite-remove"
  | "queue-add"
  | "play-next"
  | "album-play"
  | "album-shuffle"
  | "playlist-add"
  | "search"
  | "recommendation-impression"
  | "recommendation-click"
  | "dislike"
  | "undislike"
  | "artist-mute"
  | "artist-unmute";

export type EngagementEntityType = "song" | "album" | "artist" | "genre";

export type EngagementEntity = {
  type: EngagementEntityType;
  id?: string;
  name?: string;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
  genre?: string;
  year?: number;
};

/** A sparse, model-agnostic feature vector keyed by signal name. */
export type FeatureVector = Record<string, number>;

export type EngagementEvent = {
  version: 1;
  id: string;
  at: number;
  kind: EngagementKind;
  entity?: EngagementEntity;
  /** Impression batches carry several entities plus their ranker features. */
  items?: EngagementEntity[];
  features?: FeatureVector[];
  text?: string;
  value?: number;
  position?: number;
  daypart: ListeningDaypart;
  hour: number;
  weekday: number;
  weekend: boolean;
};

export type EngagementEventInput = {
  kind: EngagementKind;
  at?: number;
  entity?: EngagementEntity;
  items?: EngagementEntity[];
  features?: FeatureVector[];
  text?: string;
  value?: number;
  position?: number;
};

export type EngagementStats = {
  views: number;
  favorites: number;
  unfavorites: number;
  queueAdds: number;
  playNexts: number;
  albumPlays: number;
  albumShuffles: number;
  playlistAdds: number;
  clicks: number;
  dislikes: number;
  mutes: number;
  searches: number;
  lastAt: number;
  firstAt: number;
};

export type EngagementProfile = {
  events: number;
  albums: Map<string, EngagementStats>;
  artists: Map<string, EngagementStats>;
  genres: Map<string, EngagementStats>;
  songs: Map<string, EngagementStats>;
  /** Time-decayed positive affinity, roughly 0..4 per entity. */
  albumAffinity: Map<string, number>;
  artistAffinity: Map<string, number>;
  genreAffinity: Map<string, number>;
  songAffinity: Map<string, number>;
  /** Time-decayed negative affinity from dislikes and mutes. */
  albumAversion: Map<string, number>;
  artistAversion: Map<string, number>;
  genreAversion: Map<string, number>;
  /** Tokenized search interest. */
  keywords: Map<string, number>;
  /** Entity keys ("artist:<key>") the user explicitly silenced. */
  mutes: Set<string>;
  byDaypart: Map<ListeningDaypart, number>;
  albumCoengagement: Map<string, Map<string, number>>;
  artistCoengagement: Map<string, Map<string, number>>;
  measuredAt: number;
};

const ENGAGEMENT_VERSION = 1;
const MAX_ENGAGEMENT_EVENTS = 2500;
const MAX_IMPRESSION_EVENTS = 800;
const MAX_ENGAGEMENT_AGE_DAYS = 240;
const COENGAGEMENT_SESSION_GAP_MS = 45 * 60 * 1000;
const HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const sequence = { value: 0 };

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "is", "it", "my", "me", "we", "you", "your", "volta", "song",
  "songs", "album", "albums", "artist", "artists", "music", "track", "tracks",
]);

/** How much each explicit action moves taste. Negative values pull away. */
export const ENGAGEMENT_WEIGHTS: Record<EngagementKind, number> = {
  "album-view": 0.55,
  "artist-view": 0.45,
  "genre-view": 0.35,
  "favorite-add": 3.2,
  "favorite-remove": -1.1,
  "queue-add": 1.15,
  "play-next": 1.45,
  "album-play": 2.3,
  "album-shuffle": 1.5,
  "playlist-add": 2.7,
  search: 0.4,
  "recommendation-impression": 0,
  "recommendation-click": 1.7,
  dislike: -3.4,
  undislike: 0.9,
  "artist-mute": -4.5,
  "artist-unmute": 1.2,
};

const finite = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? (value as number) : fallback;
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

export const engageKey = (value?: string) =>
  value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") || "";

export const engagementStorageKey = (server: string, username: string) =>
  `volta-engagement:v1:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  sequence.value += 1;
  return `${Date.now()}-${sequence.value}`;
};

const tokenize = (value: string) =>
  value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

export const tokenizeSearch = tokenize;

const isEntityType = (value: unknown): value is EngagementEntityType =>
  ["song", "album", "artist", "genre"].includes(String(value));

const isEntity = (value: unknown): value is EngagementEntity => {
  if (!value || typeof value !== "object") return false;
  const entity = value as Partial<EngagementEntity>;
  return isEntityType(entity.type) && (typeof entity.id === "string" || typeof entity.name === "string");
};

const isEngagementKind = (value: unknown): value is EngagementKind =>
  Object.prototype.hasOwnProperty.call(ENGAGEMENT_WEIGHTS, String(value));

const isFeatureList = (value: unknown): value is FeatureVector[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      Object.values(item as Record<string, unknown>).every(
        (entry) => typeof entry === "number" && Number.isFinite(entry),
      ),
  );

const isEngagementEvent = (value: unknown): value is EngagementEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<EngagementEvent>;
  return (
    event.version === ENGAGEMENT_VERSION &&
    typeof event.id === "string" &&
    Number.isFinite(event.at) &&
    isEngagementKind(event.kind) &&
    typeof event.daypart === "string" &&
    Number.isFinite(event.hour) &&
    Number.isFinite(event.weekday) &&
    (event.entity === undefined || isEntity(event.entity)) &&
    (event.items === undefined || (Array.isArray(event.items) && event.items.every(isEntity))) &&
    (event.features === undefined || isFeatureList(event.features))
  );
};

export function createEngagementEvent(
  input: EngagementEventInput,
): EngagementEvent {
  const at = finite(input.at, Date.now());
  const date = new Date(at);
  const hour = date.getHours();
  const weekday = date.getDay();
  return {
    version: ENGAGEMENT_VERSION,
    id: makeId(),
    at,
    kind: input.kind,
    entity: input.entity,
    items: input.items,
    features: input.features,
    text: input.text?.trim() || undefined,
    value: Number.isFinite(input.value) ? input.value : undefined,
    position: Number.isFinite(input.position) ? input.position : undefined,
    daypart: daypartForHour(hour),
    hour,
    weekday,
    weekend: weekday === 0 || weekday === 6,
  };
}

const pruneEngagement = (events: readonly EngagementEvent[], now: number) => {
  const cutoff = now - MAX_ENGAGEMENT_AGE_DAYS * DAY_MS;
  const fresh = events
    .filter((event) => event.at >= cutoff && event.at <= now + DAY_MS)
    .sort((left, right) => left.at - right.at);
  const impressions = fresh.filter((event) => event.kind === "recommendation-impression");
  const others = fresh.filter((event) => event.kind !== "recommendation-impression");
  const trimmedImpressions =
    impressions.length > MAX_IMPRESSION_EVENTS
      ? impressions.slice(-MAX_IMPRESSION_EVENTS)
      : impressions;
  return [...others, ...trimmedImpressions]
    .sort((left, right) => left.at - right.at)
    .slice(-MAX_ENGAGEMENT_EVENTS);
};

export function readEngagement(
  storage: Storage,
  key: string,
  now = Date.now(),
): EngagementEvent[] {
  if (!key) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw) as { version?: unknown; events?: unknown };
    if (value?.version !== ENGAGEMENT_VERSION || !Array.isArray(value.events))
      return [];
    return pruneEngagement(value.events.filter(isEngagementEvent), now);
  } catch {
    return [];
  }
}

export function writeEngagement(
  storage: Storage,
  key: string,
  events: readonly EngagementEvent[],
  now = Date.now(),
) {
  const next = pruneEngagement(events, now);
  try {
    storage.setItem(key, JSON.stringify({ version: ENGAGEMENT_VERSION, events: next }));
  } catch {
    // Engagement tracking is best-effort; the player must keep working.
  }
  return next;
}

export function appendEngagement(
  storage: Storage,
  key: string,
  event: EngagementEvent,
  now = Date.now(),
): EngagementEvent[] {
  const existing = readEngagement(storage, key, now);
  if (existing.some((item) => item.id === event.id)) return existing;
  return writeEngagement(storage, key, [...existing, event], now);
}

export function clearEngagement(storage: Storage, key: string) {
  if (!key) return;
  try {
    storage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}

const emptyStats = (): EngagementStats => ({
  views: 0,
  favorites: 0,
  unfavorites: 0,
  queueAdds: 0,
  playNexts: 0,
  albumPlays: 0,
  albumShuffles: 0,
  playlistAdds: 0,
  clicks: 0,
  dislikes: 0,
  mutes: 0,
  searches: 0,
  lastAt: 0,
  firstAt: Number.POSITIVE_INFINITY,
});

const statsFor = (map: Map<string, EngagementStats>, key: string) => {
  if (!key) return null;
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyStats();
  map.set(key, created);
  return created;
};

const addValue = (map: Map<string, number>, key: string, value: number) => {
  if (!key || !Number.isFinite(value)) return;
  map.set(key, (map.get(key) || 0) + value);
};

const addCoengagement = (
  map: Map<string, Map<string, number>>,
  left: string,
  right: string,
  weight: number,
) => {
  if (!left || !right || left === right || weight <= 0) return;
  const row = map.get(left) || new Map<string, number>();
  row.set(right, (row.get(right) || 0) + weight);
  map.set(left, row);
};

const recordStats = (
  stats: EngagementStats | null,
  event: EngagementEvent,
  weight: number,
) => {
  if (!stats) return;
  switch (event.kind) {
    case "album-view":
    case "artist-view":
    case "genre-view":
      stats.views += 1;
      break;
    case "favorite-add":
      stats.favorites += 1;
      break;
    case "favorite-remove":
      stats.unfavorites += 1;
      break;
    case "queue-add":
      stats.queueAdds += 1;
      break;
    case "play-next":
      stats.playNexts += 1;
      break;
    case "album-play":
      stats.albumPlays += 1;
      break;
    case "album-shuffle":
      stats.albumShuffles += 1;
      break;
    case "playlist-add":
      stats.playlistAdds += 1;
      break;
    case "recommendation-click":
      stats.clicks += 1;
      break;
    case "dislike":
      stats.dislikes += 1;
      break;
    case "artist-mute":
      stats.mutes += 1;
      break;
    case "search":
      stats.searches += 1;
      break;
    default:
      break;
  }
  if (weight > 0 || event.kind.startsWith("dislike") || event.kind.endsWith("mute")) {
    stats.lastAt = Math.max(stats.lastAt, event.at);
    stats.firstAt = Math.min(stats.firstAt, event.at);
  }
};

const decay = (ageDays: number, halfLifeDays = HALF_LIFE_DAYS) =>
  ageDays <= 0 ? 1 : 0.5 ** (ageDays / halfLifeDays);

/**
 * Turn raw engagement into a compact, time-decayed taste model.
 *
 * Signals cascade: acting on an album also nudges its artist and genres, but
 * with smaller weights, so a single album interaction can't overpower direct
 * artist or genre evidence.
 */
export function summarizeEngagement(
  events: readonly EngagementEvent[],
  now = Date.now(),
): EngagementProfile {
  const profile: EngagementProfile = {
    events: events.length,
    albums: new Map(),
    artists: new Map(),
    genres: new Map(),
    songs: new Map(),
    albumAffinity: new Map(),
    artistAffinity: new Map(),
    genreAffinity: new Map(),
    songAffinity: new Map(),
    albumAversion: new Map(),
    artistAversion: new Map(),
    genreAversion: new Map(),
    keywords: new Map(),
    mutes: new Set(),
    byDaypart: new Map(),
    albumCoengagement: new Map(),
    artistCoengagement: new Map(),
    measuredAt: now,
  };

  for (const event of events) {
    const base = ENGAGEMENT_WEIGHTS[event.kind] ?? 0;
    const ageDays = Math.max(0, (now - event.at) / DAY_MS);
    const weighted = base * decay(ageDays, event.kind === "search" ? 14 : HALF_LIFE_DAYS);
    profile.byDaypart.set(
      event.daypart,
      (profile.byDaypart.get(event.daypart) || 0) + Math.abs(weighted) + 0.15,
    );

    if (event.kind === "search" && event.text) {
      tokenize(event.text).forEach((token) => {
        addValue(profile.keywords, token, decay(ageDays, 14));
      });
    }

    const entity = event.entity;
    if (entity) {
      const albumId =
        entity.type === "album" ? engageKey(entity.id) : engageKey(entity.albumId);
      const artistId = engageKey(entity.artistId) || (entity.type === "artist" ? engageKey(entity.id) : "");
      const genres = entity.genre ? entity.genre.split(/[,;|/]+/).map(engageKey).filter(Boolean) : [];
      const entityKey = engageKey(entity.id) || engageKey(entity.name);

      if (entity.type === "album") {
        recordStats(statsFor(profile.albums, entityKey), event, weighted);
        if (weighted >= 0) addValue(profile.albumAffinity, entityKey, weighted);
        else addValue(profile.albumAversion, entityKey, Math.abs(weighted));
      } else if (entity.type === "artist") {
        recordStats(statsFor(profile.artists, entityKey), event, weighted);
        if (weighted >= 0) addValue(profile.artistAffinity, entityKey, weighted);
        else addValue(profile.artistAversion, entityKey, Math.abs(weighted));
      } else if (entity.type === "genre") {
        recordStats(statsFor(profile.genres, entityKey), event, weighted);
        if (weighted >= 0) addValue(profile.genreAffinity, entityKey, weighted);
        else addValue(profile.genreAversion, entityKey, Math.abs(weighted));
      } else {
        recordStats(statsFor(profile.songs, entityKey), event, weighted);
        if (weighted > 0) addValue(profile.songAffinity, entityKey, weighted);
      }

      if (event.kind === "artist-mute" && artistId) profile.mutes.add(`artist:${artistId}`);
      if (event.kind === "artist-unmute" && artistId) profile.mutes.delete(`artist:${artistId}`);

      if (weighted > 0) {
        // Cascade album/song engagement onto artist and genre taste.
        if (entity.type === "album") {
          addValue(profile.artistAffinity, artistId, weighted * 0.55);
          genres.forEach((genre) => addValue(profile.genreAffinity, genre, weighted * 0.32));
        } else if (entity.type === "song") {
          addValue(profile.albumAffinity, albumId, weighted * 0.5);
          addValue(profile.artistAffinity, artistId, weighted * 0.5);
          genres.forEach((genre) => addValue(profile.genreAffinity, genre, weighted * 0.3));
        }
      } else if (weighted < 0) {
        if (entity.type === "album") {
          addValue(profile.artistAversion, artistId, Math.abs(weighted) * 0.45);
        } else if (entity.type === "genre") {
          addValue(profile.genreAversion, entityKey, Math.abs(weighted));
        }
      }

    }
  }

  // Album co-engagement: albums acted on together in one sitting are similar,
  // which gives the ranker a first-party item-to-item similarity signal.
  const acted = events
    .filter((event) => event.entity?.type === "album" && ENGAGEMENT_WEIGHTS[event.kind] > 0)
    .sort((left, right) => left.at - right.at);
  // Group by wall-clock proximity; engagement events don't carry session IDs.
  const sessions: EngagementEvent[][] = [];
  for (const event of acted) {
    const current = sessions[sessions.length - 1];
    const previousAt = current?.[current.length - 1]?.at ?? 0;
    if (!current || event.at - previousAt > COENGAGEMENT_SESSION_GAP_MS)
      sessions.push([event]);
    else current.push(event);
  }
  for (const bucket of sessions) {
    const unique = new Map<string, { albumId: string; artistId: string; at: number }>();
    for (const event of bucket) {
      const albumId = engageKey(event.entity?.id);
      if (!albumId) continue;
      const existing = unique.get(albumId);
      if (!existing) {
        unique.set(albumId, {
          albumId,
          artistId: engageKey(event.entity?.artistId),
          at: event.at,
        });
      }
    }
    const entries = [...unique.values()];
    for (let left = 0; left < entries.length; left++) {
      for (let right = left + 1; right < entries.length; right++) {
        const gap = Math.abs(entries[left].at - entries[right].at) / (60 * 60 * 1000);
        const weight = 1 / (1 + gap * 0.25);
        addCoengagement(profile.albumCoengagement, entries[left].albumId, entries[right].albumId, weight);
        addCoengagement(profile.albumCoengagement, entries[right].albumId, entries[left].albumId, weight);
        if (entries[left].artistId && entries[right].artistId)
          addCoengagement(
            profile.artistCoengagement,
            entries[left].artistId,
            entries[right].artistId,
            weight,
          );
      }
    }
  }

  return profile;
}

const normalizedMapValue = (
  map: Map<string, number> | undefined,
  key: string,
) => {
  if (!key || !map || !map.size) return 0;
  let maximum = 0;
  for (const value of map.values()) maximum = Math.max(maximum, value);
  return maximum > 0 ? clamp((map.get(key) || 0) / maximum) : 0;
};

export const normalizedAffinity = normalizedMapValue;

export const normalizedGenreAffinity = (
  map: Map<string, number> | undefined,
  keys: readonly string[],
) => (keys.length ? Math.max(...keys.map((key) => normalizedMapValue(map, key))) : 0);

/** Cosine-style similarity between two albums from co-engagement counts. */
export const coengagementSimilarity = (
  profile: EngagementProfile | undefined,
  seedId: string,
  candidateId: string,
) => {
  if (!profile || !seedId || !candidateId || seedId === candidateId) return 0;
  const row = profile.albumCoengagement.get(seedId);
  const direct = row?.get(candidateId) || 0;
  if (!direct) return 0;
  let seedTotal = 0;
  for (const value of row?.values() || []) seedTotal += value;
  const reverse = profile.albumCoengagement.get(candidateId);
  let candidateTotal = 0;
  for (const value of reverse?.values() || []) candidateTotal += value;
  const denominator = Math.sqrt(Math.max(1, seedTotal) * Math.max(1, candidateTotal));
  return clamp(direct / denominator);
};

export const keywordAffinity = (
  profile: EngagementProfile | undefined,
  text: string,
) => {
  if (!profile || !text || !profile.keywords.size) return 0;
  const tokens = tokenize(text);
  if (!tokens.length) return 0;
  let best = 0;
  for (const token of tokens) best = Math.max(best, normalizedMapValue(profile.keywords, token));
  return best;
};
