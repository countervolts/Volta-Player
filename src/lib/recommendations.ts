import type { AlbumRecord, Song } from "./navidrome";
import {
  daypartForHour,
  type ListeningContext,
  type ListeningProfile,
  type ListeningStats,
} from "./listening-history";

/**
 * A recommendation is deliberately explainable. The player does not have a
 * server-side model or a cross-user catalogue, so every score can be traced to
 * metadata and first-party listening signals available to the current user.
 */
export type AlbumRecommendation = {
  album: AlbumRecord;
  score: number;
  reason: string;
  signals: {
    artist: number;
    genre: number;
    album: number;
    recent: number;
    frequent: number;
    favorite: number;
    context: number;
    freshness: number;
    exploration: number;
    era: number;
    history: number;
    time: number;
    transition: number;
    duration: number;
    skipPenalty: number;
  };
};

export type AlbumRecommendationInput = {
  candidates: readonly AlbumRecord[];
  recentlyPlayed?: readonly AlbumRecord[];
  frequentlyPlayed?: readonly AlbumRecord[];
  recentlyAdded?: readonly AlbumRecord[];
  favoriteAlbumIds?: ReadonlySet<string>;
  contextSongs?: readonly Song[];
  excludeAlbumIds?: ReadonlySet<string>;
  listeningProfile?: ListeningProfile;
  now?: Date;
  limit?: number;
};

type AlbumProfile = {
  artists: Map<string, number>;
  genres: Map<string, number>;
  albums: Map<string, number>;
  recent: Map<string, number>;
  frequent: Map<string, number>;
  freshness: Map<string, number>;
  favoriteAlbumIds: ReadonlySet<string>;
  yearTotal: number;
  yearWeight: number;
  contextArtists: Map<string, number>;
  contextGenres: Map<string, number>;
};

type ScoredAlbum = AlbumRecommendation & {
  artistKey: string;
  genreKeys: string[];
};

const normalize = (value?: string) =>
  value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") || "";

const artistKey = (album: AlbumRecord) =>
  normalize(album.artistId || album.artist);

const albumKey = (album: AlbumRecord) => album.id.trim();

const genreKeys = (value?: string) =>
  [...new Set(
    (value || "")
      .split(/[,;|/]+/)
      .map(normalize)
      .filter(Boolean),
  )];

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const add = (map: Map<string, number>, key: string, value: number) => {
  if (!key || !Number.isFinite(value) || value <= 0) return;
  map.set(key, (map.get(key) || 0) + value);
};

const positionalWeight = (index: number, length: number, base: number) => {
  if (!length) return 0;
  // The first few rows of a server-ranked list are stronger evidence, but the
  // tail still matters. This is a smooth decay rather than a brittle cutoff.
  return base * (0.42 + 0.58 * Math.exp(-index / Math.max(1, length * 0.42)));
};

const normalizedMapValue = (map: Map<string, number>, key: string) => {
  if (!key || !map.size) return 0;
  let maximum = 0;
  for (const value of map.values()) maximum = Math.max(maximum, value);
  return maximum > 0 ? clamp((map.get(key) || 0) / maximum) : 0;
};

const normalizedGenreValue = (
  map: Map<string, number>,
  keys: readonly string[],
) => {
  if (!keys.length || !map.size) return 0;
  return Math.max(...keys.map((key) => normalizedMapValue(map, key)), 0);
};

const statCompletion = (stats?: ListeningStats) =>
  stats && stats.completionSamples > 0
    ? clamp(stats.completionRatioTotal / stats.completionSamples)
    : 0;

const statAffinity = (stats: ListeningStats | undefined, now: Date) => {
  if (!stats || !stats.starts) return 0;
  const ageDays = Math.max(0, (now.getTime() - stats.lastPlayedAt) / 86_400_000);
  const recency = stats.lastPlayedAt
    ? Math.exp(-ageDays / 21)
    : 0;
  const volume = clamp(Math.log1p(stats.starts) / Math.log1p(12));
  const replay = clamp((stats.starts - 1) / 6);
  const skipPenalty = clamp(stats.earlySkips / Math.max(1, stats.starts));
  return clamp(
    volume * 0.28 +
      recency * 0.3 +
      statCompletion(stats) * 0.25 +
      replay * 0.12 -
      skipPenalty * 0.3,
  );
};

const contextAffinity = (
  source: ListeningContext | undefined,
  kind: "songs" | "albums" | "artists" | "genres",
  key: string,
  now: Date,
) => {
  if (!source || !key) return 0;
  const map = source[kind];
  const stats = map.get(key);
  if (!stats || !stats.starts) return 0;
  let maximumStarts = 0;
  for (const value of map.values()) maximumStarts = Math.max(maximumStarts, value.starts);
  const contextualVolume = maximumStarts
    ? clamp(Math.log1p(stats.starts) / Math.log1p(maximumStarts))
    : 0;
  return clamp(
    contextualVolume * 0.58 +
      statCompletion(stats) * 0.27 +
      statAffinity(stats, now) * 0.15,
  );
};

const transitionAffinity = (
  profile: ListeningProfile | undefined,
  fromAlbumId: string | undefined,
  toAlbumId: string,
) => {
  if (!profile || !fromAlbumId || !toAlbumId) return 0;
  const transitions = profile.albumTransitions.get(fromAlbumId);
  if (!transitions) return 0;
  const count = transitions.get(toAlbumId) || 0;
  let maximum = 0;
  for (const value of transitions.values()) maximum = Math.max(maximum, value);
  return maximum ? clamp(count / maximum) : 0;
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

// A small deterministic daily rotation prevents a cold-start slate from being
// identical forever without making render output or tests depend on Math.random.
const stableRotation = (value: string, date: Date) => {
  let hash = 2166136261;
  for (const character of `${dateKey(date)}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

const songArtistKey = (song: Song) =>
  normalize(song.artistId || song.albumArtist || song.artist);

const songGenreKeys = (song: Song) => genreKeys(song.genre);

const addAlbumSignal = (
  profile: AlbumProfile,
  album: AlbumRecord,
  weight: number,
  target: "taste" | "recent" | "frequent" | "freshness",
) => {
  const id = albumKey(album);
  const artist = artistKey(album);
  const genres = genreKeys(album.genre);
  if (target === "recent") add(profile.recent, id, weight);
  if (target === "frequent") add(profile.frequent, id, weight);
  if (target === "freshness") add(profile.freshness, id, weight);
  if (target === "taste") {
    add(profile.albums, id, weight);
    add(profile.artists, artist, weight);
    genres.forEach((genre) => add(profile.genres, genre, weight));
    if (Number.isFinite(album.year)) {
      profile.yearTotal += album.year! * weight;
      profile.yearWeight += weight;
    }
  }
};

const buildProfile = (input: AlbumRecommendationInput): AlbumProfile => {
  const profile: AlbumProfile = {
    artists: new Map(),
    genres: new Map(),
    albums: new Map(),
    recent: new Map(),
    frequent: new Map(),
    freshness: new Map(),
    favoriteAlbumIds: input.favoriteAlbumIds || new Set(),
    yearTotal: 0,
    yearWeight: 0,
    contextArtists: new Map(),
    contextGenres: new Map(),
  };

  const addList = (
    albums: readonly AlbumRecord[] | undefined,
    base: number,
    target: "taste" | "recent" | "frequent" | "freshness",
  ) => {
    if (!albums?.length) return;
    albums.forEach((album, index) =>
      addAlbumSignal(profile, album, positionalWeight(index, albums.length, base), target),
    );
  };

  // Recent and frequent lists are implicit feedback, not explicit ratings. We
  // use both because recency captures current intent while frequency captures
  // durable taste. Favorites are the strongest explicit signal available.
  addList(input.recentlyPlayed, 1.18, "taste");
  addList(input.recentlyPlayed, 1.05, "recent");
  addList(input.frequentlyPlayed, 1.1, "taste");
  addList(input.frequentlyPlayed, 1.0, "frequent");
  addList(input.recentlyAdded, 0.16, "taste");
  addList(input.recentlyAdded, 1.0, "freshness");

  for (const id of profile.favoriteAlbumIds) {
    // A favorite album may not be present in the current candidate response,
    // but its ID should still be available as a strong future signal.
    add(profile.albums, id, 1.45);
  }

  // A current/upcoming session is useful short-term context, but it is kept
  // separate from long-term taste so one accidental play cannot rewrite a
  // user's profile.
  (input.contextSongs || []).forEach((song, index) => {
    const weight = index === 0 ? 1.35 : Math.max(0.35, 0.92 - index * 0.1);
    add(profile.contextArtists, songArtistKey(song), weight);
    songGenreKeys(song).forEach((genre) => add(profile.contextGenres, genre, weight));
  });

  return profile;
};

const mergeAlbums = (groups: readonly (readonly AlbumRecord[])[]) => {
  const albums = new Map<string, AlbumRecord>();
  for (const group of groups) {
    for (const album of group) {
      const id = albumKey(album);
      if (!id) continue;
      const existing = albums.get(id);
      // Later responses often contain richer records (for example a favorite
      // result may carry a starred date). Merge without losing cover art or
      // metadata from the earlier candidate source.
      albums.set(id, existing ? { ...existing, ...album } : album);
    }
  }
  return [...albums.values()];
};

const genreOverlap = (left: readonly string[], right: readonly string[]) => {
  if (!left.length || !right.length) return 0;
  const other = new Set(right);
  return left.some((genre) => other.has(genre)) ? 1 : 0;
};

const similarity = (left: ScoredAlbum, right: ScoredAlbum) => {
  const sameArtist = Boolean(left.artistKey && left.artistKey === right.artistKey);
  const sameGenre = genreOverlap(left.genreKeys, right.genreKeys);
  return sameArtist ? 1 : sameGenre * 0.48;
};

const formatGenre = (album: AlbumRecord) => {
  const genre = (album.genre || "").split(/[,;|/]+/)[0]?.trim();
  return genre || "this sound";
};

const reasonFor = (item: ScoredAlbum) => {
  const { album, signals } = item;
  const artist = album.artist?.trim() || "this artist";
  if (signals.favorite >= 1) return "Because you saved this album";
  if (signals.context > 0.72 && item.artistKey) return `More from ${artist}`;
  if (signals.time > 0.72) return "A fit for your listening time";
  if (signals.history > 0.72) return "From your listening history";
  if (signals.frequent >= 0.58) return "From your heavy rotation";
  if (signals.recent >= 0.58) return "A familiar record you may want back";
  if (signals.genre >= 0.58) return `Because you play ${formatGenre(album)}`;
  if (signals.freshness >= 0.62) return "A new arrival in your collection";
  return "A fresh turn from your collection";
};

/**
 * Rank album candidates for the Home shelf.
 *
 * This is intentionally a small hybrid recommender rather than a pretend ML
 * model. It combines server-ranked implicit feedback, explicit favorites,
 * content metadata, short-term queue context, deterministic exploration, and
 * a maximal-marginal-relevance-style diversity pass. The function is pure so
 * it can be evaluated cheaply with useMemo and tested independently of React.
 */
export function rankAlbumRecommendations(
  input: AlbumRecommendationInput,
): AlbumRecommendation[] {
  const limit = Math.max(0, Math.trunc(input.limit ?? 8));
  if (!limit || !input.candidates.length) return [];
  const now = input.now || new Date();
  const profile = buildProfile(input);
  const excluded = input.excludeAlbumIds || new Set<string>();
  const listeningProfile = input.listeningProfile;
  const hour = now.getHours();
  const weekday = now.getDay();
  const daypart = daypartForHour(hour);
  const currentAlbumId = input.contextSongs?.[0]?.albumId;
  const tasteYear =
    profile.yearWeight > 0 ? profile.yearTotal / profile.yearWeight : null;

  const scored: ScoredAlbum[] = mergeAlbums([input.candidates])
    .filter((album) => !excluded.has(albumKey(album)))
    .map((album) => {
      const id = albumKey(album);
      const artist = artistKey(album);
      const genres = genreKeys(album.genre);
      const artistAffinity = normalizedMapValue(profile.artists, artist);
      const genreAffinity = normalizedGenreValue(profile.genres, genres);
      const albumAffinity = normalizedMapValue(profile.albums, id);
      const recent = normalizedMapValue(profile.recent, id);
      const frequent = normalizedMapValue(profile.frequent, id);
      const freshness = normalizedMapValue(profile.freshness, id);
      const contextArtist = normalizedMapValue(profile.contextArtists, artist);
      const contextGenre = normalizedGenreValue(profile.contextGenres, genres);
      const context = Math.max(contextArtist, contextGenre);
      const favorite = profile.favoriteAlbumIds.has(id) || Boolean(album.starred) ? 1 : 0;
      const history = statAffinity(listeningProfile?.albums.get(id), now);
      const historyArtist = statAffinity(
        listeningProfile?.artists.get(artist),
        now,
      );
      const historyGenre = Math.max(
        ...genres.map((genre) =>
          statAffinity(listeningProfile?.genres.get(genre), now),
        ),
        0,
      );
      const historicalTaste = Math.max(history, historyArtist, historyGenre);
      const time = Math.max(
        contextAffinity(
          listeningProfile?.byDaypart.get(daypart),
          "albums",
          id,
          now,
        ),
        contextAffinity(
          listeningProfile?.byHour.get(hour),
          "albums",
          id,
          now,
        ) * 0.92,
        contextAffinity(
          listeningProfile?.byWeekday.get(weekday),
          "albums",
          id,
          now,
        ) * 0.78,
      );
      const transition = transitionAffinity(
        listeningProfile,
        currentAlbumId,
        id,
      );
      const candidateTrackSeconds =
        album.duration && album.songCount
          ? album.duration / album.songCount
          : 0;
      const duration =
        candidateTrackSeconds > 0 && listeningProfile?.averageTrackSeconds
          ? clamp(
              1 -
                Math.abs(
                  candidateTrackSeconds - listeningProfile.averageTrackSeconds,
                ) / 120,
            )
          : 0;
      const skipStats = listeningProfile?.albums.get(id);
      const skipPenalty = skipStats
        ? clamp(skipStats.earlySkips / Math.max(1, skipStats.starts))
        : 0;
      const era =
        tasteYear !== null && Number.isFinite(album.year)
          ? clamp(1 - Math.abs(album.year! - tasteYear) / 28)
          : 0;
      const familiarity = clamp(
        artistAffinity * 0.44 + genreAffinity * 0.36 + albumAffinity * 0.2,
      );
      const exploration = clamp(
        (1 - familiarity) * 0.55 + stableRotation(id, now) * 0.45,
      );
      const recentPenalty = recent * 0.17;
      const score =
        artistAffinity * 0.27 +
        genreAffinity * 0.22 +
        albumAffinity * 0.12 +
        frequent * 0.13 +
        recent * 0.08 +
        favorite * 0.14 +
        context * 0.12 +
        freshness * 0.06 +
        era * 0.04 +
        exploration * 0.1 +
        historicalTaste * 0.2 +
        time * 0.12 +
        transition * 0.1 +
        duration * 0.025 -
        recentPenalty -
        skipPenalty * 0.16;
      const item: ScoredAlbum = {
        album,
        score,
        reason: "",
        signals: {
          artist: artistAffinity,
          genre: genreAffinity,
          album: albumAffinity,
          recent,
          frequent,
          favorite,
          context,
          freshness,
          exploration,
          era,
          history: historicalTaste,
          time,
          transition,
          duration,
          skipPenalty,
        },
        artistKey: artist,
        genreKeys: genres,
      };
      item.reason = reasonFor(item);
      return item;
    });

  if (!scored.length) return [];

  const remaining = [...scored];
  const selected: ScoredAlbum[] = [];
  const artistCounts = new Map<string, number>();
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const redundancy = selected.length
        ? Math.max(...selected.map((item) => similarity(candidate, item)))
        : 0;
      const artistCount = artistCounts.get(candidate.artistKey) || 0;
      // This is a modest diversity tax, not a hard artist ban. It preserves a
      // second excellent album when the library is small while preferring a
      // different artist when relevance is close.
      const value = candidate.score - redundancy * 0.14 - artistCount * 0.11;
      if (
        value > bestValue ||
        (value === bestValue &&
          candidate.album.id.localeCompare(remaining[bestIndex].album.id) < 0)
      ) {
        bestValue = value;
        bestIndex = index;
      }
    }
    const [best] = remaining.splice(bestIndex, 1);
    selected.push(best);
    artistCounts.set(best.artistKey, (artistCounts.get(best.artistKey) || 0) + 1);
  }

  return selected.map(({ artistKey: _artistKey, genreKeys: _genreKeys, ...item }) => item);
}

/** Merge server response groups while preserving the first-seen order. */
export function mergeRecommendationCandidates(
  ...groups: readonly (readonly AlbumRecord[])[]
): AlbumRecord[] {
  return mergeAlbums(groups);
}

/** Turn favorite songs into album IDs without coupling the ranker to UI state. */
export function favoriteAlbumIdsFromSongs(songs: readonly Song[]) {
  return new Set(
    songs
      .map((song) => song.albumId?.trim())
      .filter((id): id is string => Boolean(id)),
  );
}
