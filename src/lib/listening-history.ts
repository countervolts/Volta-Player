import type { Song } from "./navidrome";

export type ListeningSource = "navidrome" | "local";
export type ListeningEventKind =
  | "start"
  | "resume"
  | "pause"
  | "skip"
  | "complete"
  | "stop"
  | "seek";
export type ListeningDaypart =
  | "overnight"
  | "morning"
  | "afternoon"
  | "evening"
  | "late-night";

export type ListeningEvent = {
  version: 1;
  id: string;
  at: number;
  kind: ListeningEventKind;
  sessionId: string;
  sessionIndex: number;
  songId: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  genre?: string;
  durationSeconds: number;
  deltaSeconds: number;
  totalSeconds: number;
  positionSeconds: number;
  completionRatio: number;
  source: ListeningSource;
  queueIndex: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  daypart: ListeningDaypart;
  hour: number;
  weekday: number;
  weekend: boolean;
  reason?: string;
  seekDeltaSeconds?: number;
};

export type ListeningEventInput = {
  kind: ListeningEventKind;
  at?: number;
  sessionId: string;
  sessionIndex: number;
  durationSeconds?: number;
  deltaSeconds?: number;
  totalSeconds?: number;
  positionSeconds?: number;
  source: ListeningSource;
  queueIndex: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  reason?: string;
  seekDeltaSeconds?: number;
};

export type ListeningStats = {
  starts: number;
  resumes: number;
  pauses: number;
  skips: number;
  completes: number;
  stops: number;
  seeks: number;
  listenedSeconds: number;
  completionRatioTotal: number;
  completionSamples: number;
  earlySkips: number;
  lateSkips: number;
  forwardSeekSeconds: number;
  backwardSeekSeconds: number;
  lastPlayedAt: number;
  firstPlayedAt: number;
  sessions: number;
  /** Number of distinct calendar days this entity was heard on. */
  distinctDays: number;
  /** Average fraction of the track heard before a skip/complete/stop. */
  averagePositionRatio: number;
  positionRatioTotal: number;
  positionRatioSamples: number;
};

export type ListeningContext = {
  songs: Map<string, ListeningStats>;
  albums: Map<string, ListeningStats>;
  artists: Map<string, ListeningStats>;
  genres: Map<string, ListeningStats>;
};

export type ListeningProfile = {
  events: number;
  sessions: number;
  songs: Map<string, ListeningStats>;
  albums: Map<string, ListeningStats>;
  artists: Map<string, ListeningStats>;
  genres: Map<string, ListeningStats>;
  byDaypart: Map<ListeningDaypart, ListeningContext>;
  byHour: Map<number, ListeningContext>;
  byWeekday: Map<number, ListeningContext>;
  songTransitions: Map<string, Map<string, number>>;
  albumTransitions: Map<string, Map<string, number>>;
  /** Item-to-item co-listening within a session (both directions). */
  songCooccurrence: Map<string, Map<string, number>>;
  albumCooccurrence: Map<string, Map<string, number>>;
  artistCooccurrence: Map<string, Map<string, number>>;
  genreCooccurrence: Map<string, Map<string, number>>;
  /** Audible seconds per local hour (0-23) and weekday (0-6). */
  hourHistogram: number[];
  weekdayHistogram: number[];
  averageTrackSeconds: number;
  averageCompletionRatio: number;
};

const HISTORY_VERSION = 1;
const MAX_HISTORY_EVENTS = 4000;
const MAX_HISTORY_AGE_DAYS = 180;
const SESSION_GAP_MS = 20 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const historySequence = { value: 0 };

const finite = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? value! : fallback;
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const safeText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const entityKey = (value?: string) =>
  value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") || "";

export const daypartForHour = (hour: number): ListeningDaypart => {
  if (hour < 6) return "overnight";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "late-night";
};

const eventId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  historySequence.value += 1;
  return `${Date.now()}-${historySequence.value}`;
};

const normalizeId = (value?: string) => value?.trim() || undefined;

export function createListeningEvent(
  song: Song,
  input: ListeningEventInput,
): ListeningEvent {
  const at = finite(input.at, Date.now());
  const date = new Date(at);
  const hour = date.getHours();
  const durationSeconds = Math.max(
    0,
    finite(input.durationSeconds, finite(song.duration)),
  );
  const totalSeconds = clamp(
    Math.max(0, finite(input.totalSeconds)),
    0,
    durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER,
  );
  const deltaSeconds = clamp(
    Math.max(0, finite(input.deltaSeconds)),
    0,
    totalSeconds,
  );
  const positionSeconds = Math.max(
    0,
    finite(input.positionSeconds, totalSeconds),
  );
  const completionRatio =
    durationSeconds > 0 ? clamp(totalSeconds / durationSeconds) : 0;
  const weekday = date.getDay();

  return {
    version: HISTORY_VERSION,
    id: eventId(),
    at,
    kind: input.kind,
    sessionId: input.sessionId,
    sessionIndex: Math.max(0, Math.trunc(input.sessionIndex)),
    songId: song.id,
    title: song.title,
    artist: safeText(song.artist),
    artistId: normalizeId(song.artistId || song.albumArtist),
    album: safeText(song.album),
    albumId: normalizeId(song.albumId),
    genre: safeText(song.genre),
    durationSeconds,
    deltaSeconds,
    totalSeconds,
    positionSeconds,
    completionRatio,
    source: input.source,
    queueIndex: Math.max(0, Math.trunc(input.queueIndex)),
    shuffle: input.shuffle,
    repeat: input.repeat,
    daypart: daypartForHour(hour),
    hour,
    weekday,
    weekend: weekday === 0 || weekday === 6,
    reason: safeText(input.reason),
    seekDeltaSeconds: Number.isFinite(input.seekDeltaSeconds)
      ? input.seekDeltaSeconds
      : undefined,
  };
}

export const listeningHistoryKey = (server: string, username: string) =>
  `volta-listening-history:v1:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;

const isEventKind = (value: unknown): value is ListeningEventKind =>
  ["start", "resume", "pause", "skip", "complete", "stop", "seek"].includes(
    String(value),
  );

const isListeningEvent = (value: unknown): value is ListeningEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ListeningEvent>;
  return (
    event.version === HISTORY_VERSION &&
    typeof event.id === "string" &&
    Number.isFinite(event.at) &&
    isEventKind(event.kind) &&
    typeof event.sessionId === "string" &&
    typeof event.songId === "string" &&
    typeof event.title === "string" &&
    ["navidrome", "local"].includes(String(event.source)) &&
    Number.isFinite(event.deltaSeconds) &&
    Number.isFinite(event.totalSeconds) &&
    Number.isFinite(event.completionRatio) &&
    typeof event.daypart === "string" &&
    Number.isFinite(event.hour) &&
    Number.isFinite(event.weekday)
  );
};

const pruneEvents = (events: readonly ListeningEvent[], now: number) => {
  const cutoff = now - MAX_HISTORY_AGE_DAYS * DAY_MS;
  return events
    .filter((event) => event.at >= cutoff && event.at <= now + DAY_MS)
    .slice(-MAX_HISTORY_EVENTS);
};

export function readListeningHistory(
  storage: Storage,
  key: string,
  now = Date.now(),
): ListeningEvent[] {
  if (!key) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw) as { version?: unknown; events?: unknown };
    if (value?.version !== HISTORY_VERSION || !Array.isArray(value.events))
      return [];
    return pruneEvents(value.events.filter(isListeningEvent), now);
  } catch {
    return [];
  }
}

export function appendListeningEvent(
  storage: Storage,
  key: string,
  event: ListeningEvent,
  now = Date.now(),
): ListeningEvent[] {
  const existing = readListeningHistory(storage, key, now);
  if (existing.some((item) => item.id === event.id)) return existing;
  const next = pruneEvents([...existing, event], now);
  writeListeningHistory(storage, key, next, now);
  return next;
}

export function writeListeningHistory(
  storage: Storage,
  key: string,
  events: readonly ListeningEvent[],
  now = Date.now(),
) {
  const next = pruneEvents(events, now);
  try {
    storage.setItem(
      key,
      JSON.stringify({ version: HISTORY_VERSION, events: next }),
    );
  } catch {
    // Recommendation quality is best-effort; playback must remain unaffected
    // if storage is disabled, full, or unavailable in a private context.
  }
  return next;
}

export function clearListeningHistory(storage: Storage, key: string) {
  if (!key) return;
  try {
    storage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}

const emptyStats = (): ListeningStats => ({
  starts: 0,
  resumes: 0,
  pauses: 0,
  skips: 0,
  completes: 0,
  stops: 0,
  seeks: 0,
  listenedSeconds: 0,
  completionRatioTotal: 0,
  completionSamples: 0,
  earlySkips: 0,
  lateSkips: 0,
  forwardSeekSeconds: 0,
  backwardSeekSeconds: 0,
  lastPlayedAt: 0,
  firstPlayedAt: Number.POSITIVE_INFINITY,
  sessions: 0,
  distinctDays: 0,
  averagePositionRatio: 0,
  positionRatioTotal: 0,
  positionRatioSamples: 0,
});

const context = (): ListeningContext => ({
  songs: new Map(),
  albums: new Map(),
  artists: new Map(),
  genres: new Map(),
});

const contextMapValue = <K>(map: Map<K, ListeningContext>, key: K) => {
  const value = map.get(key);
  if (value) return value;
  const created = context();
  map.set(key, created);
  return created;
};

const statsFor = (map: Map<string, ListeningStats>, key: string) => {
  if (!key) return null;
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyStats();
  map.set(key, created);
  return created;
};

const updateStats = (
  stats: ListeningStats,
  event: ListeningEvent,
  sessions: Map<ListeningStats, Set<string>>,
  days: Map<ListeningStats, Set<string>>,
) => {
  if (event.kind === "start") stats.starts += 1;
  if (event.kind === "resume") stats.resumes += 1;
  if (event.kind === "pause") stats.pauses += 1;
  if (event.kind === "skip") stats.skips += 1;
  if (event.kind === "complete") stats.completes += 1;
  if (event.kind === "stop") stats.stops += 1;
  if (event.kind === "seek") {
    stats.seeks += 1;
    if ((event.seekDeltaSeconds || 0) >= 0)
      stats.forwardSeekSeconds += event.seekDeltaSeconds || 0;
    else stats.backwardSeekSeconds += Math.abs(event.seekDeltaSeconds || 0);
  }
  stats.listenedSeconds += Math.max(0, event.deltaSeconds);
  if (["skip", "complete", "stop"].includes(event.kind)) {
    stats.completionRatioTotal += event.completionRatio;
    stats.completionSamples += 1;
    if (event.durationSeconds > 0) {
      stats.positionRatioTotal += clamp(
        event.positionSeconds / event.durationSeconds,
      );
      stats.positionRatioSamples += 1;
    }
    if (event.kind === "skip") {
      if (event.completionRatio < 0.35) stats.earlySkips += 1;
      else stats.lateSkips += 1;
    }
  }
  if (["start", "resume"].includes(event.kind)) {
    stats.lastPlayedAt = Math.max(stats.lastPlayedAt, event.at);
    stats.firstPlayedAt = Math.min(stats.firstPlayedAt, event.at);
  }
  let ids = sessions.get(stats);
  if (!ids) {
    ids = new Set();
    sessions.set(stats, ids);
  }
  ids.add(event.sessionId);
  let daySet = days.get(stats);
  if (!daySet) {
    daySet = new Set();
    days.set(stats, daySet);
  }
  daySet.add(new Date(event.at).toISOString().slice(0, 10));
};

const updateContext = (
  target: ListeningContext,
  event: ListeningEvent,
  sessions: Map<ListeningStats, Set<string>>,
  days: Map<ListeningStats, Set<string>>,
) => {
  const song = statsFor(target.songs, event.songId);
  const album = event.albumId
    ? statsFor(target.albums, event.albumId)
    : null;
  const artist = entityKey(event.artistId || event.artist);
  const artistStats = artist
    ? statsFor(target.artists, artist)
    : null;
  const genres = (event.genre || "")
    .split(/[,;|/]+/)
    .map(entityKey)
    .filter(Boolean);
  if (song) updateStats(song, event, sessions, days);
  if (album) updateStats(album, event, sessions, days);
  if (artistStats) updateStats(artistStats, event, sessions, days);
  genres.forEach((genre) => {
    const genreStats = statsFor(target.genres, genre);
    if (genreStats) updateStats(genreStats, event, sessions, days);
  });
};

const addTransition = (
  transitions: Map<string, Map<string, number>>,
  from: string | undefined,
  to: string | undefined,
) => {
  if (!from || !to || from === to) return;
  const next = transitions.get(from) || new Map<string, number>();
  next.set(to, (next.get(to) || 0) + 1);
  transitions.set(from, next);
};

const addCooccurrence = (
  map: Map<string, Map<string, number>>,
  left: string | undefined,
  right: string | undefined,
  weight: number,
) => {
  if (!left || !right || left === right || weight <= 0) return;
  const forward = map.get(left) || new Map<string, number>();
  forward.set(right, (forward.get(right) || 0) + weight);
  map.set(left, forward);
  const backward = map.get(right) || new Map<string, number>();
  backward.set(left, (backward.get(left) || 0) + weight);
  map.set(right, backward);
};

export function summarizeListening(
  events: readonly ListeningEvent[],
): ListeningProfile {
  const profile: ListeningProfile = {
    events: events.length,
    sessions: new Set(events.map((event) => event.sessionId)).size,
    songs: new Map(),
    albums: new Map(),
    artists: new Map(),
    genres: new Map(),
    byDaypart: new Map(),
    byHour: new Map(),
    byWeekday: new Map(),
    songTransitions: new Map(),
    albumTransitions: new Map(),
    songCooccurrence: new Map(),
    albumCooccurrence: new Map(),
    artistCooccurrence: new Map(),
    genreCooccurrence: new Map(),
    hourHistogram: new Array(24).fill(0),
    weekdayHistogram: new Array(7).fill(0),
    averageTrackSeconds: 0,
    averageCompletionRatio: 0,
  };
  const sessions = new Map<ListeningStats, Set<string>>();
  const days = new Map<ListeningStats, Set<string>>();
  let durationTotal = 0;
  let durationSamples = 0;
  let completionTotal = 0;
  let completionSamples = 0;

  events.forEach((event) => {
    updateContext(
      {
        songs: profile.songs,
        albums: profile.albums,
        artists: profile.artists,
        genres: profile.genres,
      },
      event,
      sessions,
      days,
    );
    updateContext(
      contextMapValue(profile.byDaypart, event.daypart),
      event,
      sessions,
      days,
    );
    updateContext(contextMapValue(profile.byHour, event.hour), event, sessions, days);
    updateContext(
      contextMapValue(profile.byWeekday, event.weekday),
      event,
      sessions,
      days,
    );
    const audible = Math.max(0, event.deltaSeconds);
    profile.hourHistogram[event.hour] += audible;
    profile.weekdayHistogram[event.weekday] += audible;
    if (event.kind === "start" && event.durationSeconds > 0) {
      durationTotal += event.durationSeconds;
      durationSamples += 1;
    }
    if (["skip", "complete", "stop"].includes(event.kind)) {
      completionTotal += event.completionRatio;
      completionSamples += 1;
    }
  });

  const starts = events
    .filter((event) => event.kind === "start")
    .sort((left, right) => left.at - right.at);
  const previousBySession = new Map<
    string,
    { songId: string; albumId?: string; at: number }
  >();
  const bySession = new Map<string, ListeningEvent[]>();
  starts.forEach((event) => {
    const previous = previousBySession.get(event.sessionId);
    if (previous && event.at - previous.at <= SESSION_GAP_MS) {
      addTransition(profile.songTransitions, previous.songId, event.songId);
      addTransition(profile.albumTransitions, previous.albumId, event.albumId);
    }
    previousBySession.set(event.sessionId, {
      songId: event.songId,
      albumId: event.albumId,
      at: event.at,
    });
    const bucket = bySession.get(event.sessionId) || [];
    bucket.push(event);
    bySession.set(event.sessionId, bucket);
  });

  // Within-session co-listening is a stronger similarity signal than strict
  // adjacency: it survives shuffled queues and one-off track skips. Each pair
  // is weighted down by how far apart it sat in the session.
  for (const bucket of bySession.values()) {
    const albums = new Map<string, number>();
    const artists = new Map<string, number>();
    const genres = new Map<string, number>();
    const songs = new Map<string, number>();
    bucket.forEach((event, index) => {
      const weight = 1 / (1 + index * 0.08);
      if (event.albumId) albums.set(event.albumId, Math.max(albums.get(event.albumId) || 0, weight));
      const artist = entityKey(event.artistId || event.artist);
      if (artist) artists.set(artist, Math.max(artists.get(artist) || 0, weight));
      if (event.songId) songs.set(event.songId, Math.max(songs.get(event.songId) || 0, weight));
      (event.genre || "")
        .split(/[,;|/]+/)
        .map(entityKey)
        .filter(Boolean)
        .forEach((genre) => genres.set(genre, Math.max(genres.get(genre) || 0, weight)));
    });
    const pair = (
      map: Map<string, Map<string, number>>,
      entries: Map<string, number>,
    ) => {
      const list = [...entries.entries()];
      for (let left = 0; left < list.length; left++) {
        for (let right = left + 1; right < list.length; right++) {
          addCooccurrence(map, list[left][0], list[right][0], list[left][1] * list[right][1]);
        }
      }
    };
    pair(profile.albumCooccurrence, albums);
    pair(profile.artistCooccurrence, artists);
    pair(profile.genreCooccurrence, genres);
    pair(profile.songCooccurrence, songs);
  }

  sessions.forEach((ids, stats) => {
    stats.sessions = ids.size;
    if (!Number.isFinite(stats.firstPlayedAt)) stats.firstPlayedAt = 0;
  });
  days.forEach((dates, stats) => {
    stats.distinctDays = dates.size;
  });
  for (const stats of sessions.keys()) {
    stats.averagePositionRatio = stats.positionRatioSamples
      ? stats.positionRatioTotal / stats.positionRatioSamples
      : 0;
  }
  profile.averageTrackSeconds = durationSamples
    ? durationTotal / durationSamples
    : 0;
  profile.averageCompletionRatio = completionSamples
    ? completionTotal / completionSamples
    : 0;
  return profile;
}
