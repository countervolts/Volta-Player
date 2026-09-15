import type { AlbumRecord, Song } from "./navidrome";
import {
  daypartForHour,
  type ListeningContext,
  type ListeningProfile,
  type ListeningStats,
} from "./listening-history";
import {
  coengagementSimilarity,
  keywordAffinity,
  type EngagementProfile,
  type FeatureVector,
} from "./interactions";
import { blendLearnedScore, type RankerModel } from "./learned-ranker";
import {
  DEFAULT_RECOMMENDATION_TUNING,
  normalizeRecommendationTuning,
  recommendationTuningWeights,
  type RecommendationTuning,
} from "./recommendation-tuning";

/**
 * A recommendation is deliberately explainable. The player does not have a
 * server-side model or a cross-user catalogue, so every score can be traced to
 * metadata and first-party signals available to the current user.
 *
 * The ranker is a hybrid:
 *  - server-ranked implicit feedback (recent / frequent) and explicit favorites
 *  - first-party playback history (completion, replays, skips, session links)
 *  - first-party engagement (views, queues, playlist adds, searches, dislikes)
 *  - content metadata (artist, genre, era, track length)
 *  - item-to-item similarity learned from this user's own sessions
 *  - a locally trained logistic model that re-ranks on top of the priors
 *  - an exposure-gated discovery term and an MMR-style diversity pass
 *
 * Relevance and discovery are scored as two separate questions. Relevance asks
 * "would you like this"; discovery asks "is this something you have not
 * actually heard yet, that still fits your taste". Risk appetite blends the
 * two, so raising it reaches genuinely unplayed material instead of only
 * reshuffling records already in heavy rotation.
 */
export type RecommendationSignals = {
  artist: number;
  genre: number;
  album: number;
  recent: number;
  frequent: number;
  favorite: number;
  context: number;
  freshness: number;
  era: number;
  history: number;
  time: number;
  transition: number;
  duration: number;
  skipPenalty: number;
  engagement: number;
  engagementArtist: number;
  engagementGenre: number;
  search: number;
  aversion: number;
  cooccurrence: number;
  coengagement: number;
  loyalty: number;
  replay: number;
  rediscovery: number;
  novelty: number;
  /** How much of this item the listener has already consumed. */
  exposure: number;
  /** The pure-discovery score used when risk appetite is high. */
  discovery: number;
  overlooked: number;
  fatigue: number;
  tasteFit: number;
  learned: number;
};
export type AlbumRecommendation = {
  album: AlbumRecord;
  score: number;
  reason: string;
  signals: RecommendationSignals;
  /** Feature vector used for local learning; mirrors the signals. */
  features: FeatureVector;
};

export type AlbumRecommendationInput = {
  candidates: readonly AlbumRecord[];
  /** Extra candidates fetched because of personalization (top artists, etc). */
  discoveryCandidates?: readonly AlbumRecord[];
  /**
   * The library-wide album pool. Real discovery needs a candidate set far
   * larger than the handful of server lists a home page happens to show, so the
   * app supplies the whole library here and the ranker does genuine retrieval
   * over it rather than only reordering a pre-selected shelf.
   */
  libraryPool?: readonly AlbumRecord[];
  recentlyPlayed?: readonly AlbumRecord[];
  frequentlyPlayed?: readonly AlbumRecord[];
  recentlyAdded?: readonly AlbumRecord[];
  favoriteAlbumIds?: ReadonlySet<string>;
  contextSongs?: readonly Song[];
  excludeAlbumIds?: ReadonlySet<string>;
  listeningProfile?: ListeningProfile;
  engagementProfile?: EngagementProfile;
  rankerModel?: RankerModel;
  /** User-facing dials that reshape the prior. Defaults reproduce the base ranker. */
  tuning?: RecommendationTuning;
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
  /** 0 = the listener has never touched this, 1 = deep in heavy rotation. */
  exposure: number;
};

type TasteSeeds = {
  albums: string[];
  artists: string[];
  genres: string[];
  shuffleBias: number;
};

const normalize = (value?: string) =>
  value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") || "";

/**
 * Exposure at or above this means the listener has genuinely worn the album
 * out, as opposed to merely encountered it. Used to gate the shelf so heavy
 * rotation cannot occupy it at high risk appetite.
 */
const ROTATION_EXPOSURE = 0.6;

/** Score demotion applied to worn-out albums, scaled by risk appetite. */
const ROTATION_PENALTY = 0.55;

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

/** Cache normalization per ranking call; a full library must not rescan
 * every affinity map for every candidate. No cross-user mutable cache. */
const affinityLookup = () => {
  const maxima = new Map<Map<string, number>, number>();
  const value = (map: Map<string, number> | undefined, key: string) => {
    if (!map || !key) return 0;
    let maximum = maxima.get(map);
    if (maximum === undefined) {
      maximum = 0;
      for (const amount of map.values()) maximum = Math.max(maximum, amount);
      maxima.set(map, maximum);
    }
    return maximum > 0 ? clamp((map.get(key) || 0) / maximum) : 0;
  };
  const genres = (map: Map<string, number> | undefined, keys: readonly string[]) =>
    Math.max(0, ...keys.map((key) => value(map, key)));
  return { value, genres };
};

const statCompletion = (stats?: ListeningStats) =>
  stats && stats.completionSamples > 0
    ? clamp(stats.completionRatioTotal / stats.completionSamples)
    : 0;

const statAffinity = (stats: ListeningStats | undefined, now: Date) => {
  if (!stats || !stats.starts) return 0;
  const ageDays = Math.max(0, (now.getTime() - stats.lastPlayedAt) / 86_400_000);
  const recency = stats.lastPlayedAt ? Math.exp(-ageDays / 21) : 0;
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
  ) * stats.starts / (stats.starts + 3);
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

const cosineSimilarity = (
  map: Map<string, Map<string, number>> | undefined,
  seed: string,
  candidate: string,
) => {
  if (!map || !seed || !candidate || seed === candidate) return 0;
  const row = map.get(seed);
  const direct = row?.get(candidate) || 0;
  if (!direct) return 0;
  let seedTotal = 0;
  for (const value of row?.values() || []) seedTotal += value;
  let candidateTotal = 0;
  for (const value of map.get(candidate)?.values() || []) candidateTotal += value;
  const denominator = Math.sqrt(Math.max(1, seedTotal) * Math.max(1, candidateTotal));
  return clamp(direct / denominator) * direct / (direct + 2);
};

const bestCosine = (
  map: Map<string, Map<string, number>> | undefined,
  seeds: readonly string[],
  candidate: string,
) => {
  if (!map || !seeds.length || !candidate) return 0;
  let best = 0;
  for (const seed of seeds) best = Math.max(best, cosineSimilarity(map, seed, candidate));
  return best;
};

const topKeys = (map: Map<string, number>, limit: number) =>
  [...map.entries()]
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key]) => key);

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
  // Library additions are availability, not evidence of personal taste.
  addList(input.recentlyAdded, 1.0, "freshness");

  const metadata = new Map(mergeAlbums([input.candidates, input.discoveryCandidates || [], input.libraryPool || []]).map((album) => [album.id, album]));
  for (const id of profile.favoriteAlbumIds) {
    // A favorite album may not be present in the current candidate response,
    // but its ID should still be available as a strong future signal.
    const album = metadata.get(id);
    if (album) addAlbumSignal(profile, album, 1.45, "taste");
    else add(profile.albums, id, 1.45);
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

/**
 * Pick the albums, artists, and genres that best summarize this listener, then
 * use them as seeds for first-party item-to-item similarity.
 */
const buildSeeds = (
  input: AlbumRecommendationInput,
  profile: AlbumProfile,
  now: Date,
): TasteSeeds => {
  const history = input.listeningProfile;
  const engagement = input.engagementProfile;
  const albumScores = new Map(profile.albums);
  const artistScores = new Map(profile.artists);
  const genreScores = new Map(profile.genres);

  history?.albums.forEach((stats, id) => {
    add(albumScores, id, statAffinity(stats, now) * 1.8);
  });
  history?.artists.forEach((stats, id) => {
    add(artistScores, id, statAffinity(stats, now) * 1.8);
  });
  history?.genres.forEach((stats, id) => {
    add(genreScores, id, statAffinity(stats, now) * 1.6);
  });
  const addNormalized = (
    target: Map<string, number>,
    source: Map<string, number> | undefined,
    scale: number,
  ) => {
    if (!source?.size) return;
    let maximum = 0;
    for (const value of source.values()) maximum = Math.max(maximum, value);
    if (maximum <= 0) return;
    source.forEach((value, key) => {
      if (!key) return;
      add(target, key, (value / maximum) * scale + value * 0.05);
    });
  };
  addNormalized(albumScores, engagement?.albumAffinity, 1.4);
  addNormalized(artistScores, engagement?.artistAffinity, 1.4);
  addNormalized(genreScores, engagement?.genreAffinity, 1.3);

  let plays = 0;
  let shuffles = 0;
  engagement?.albums.forEach((stats) => {
    plays += stats.albumPlays;
    shuffles += stats.albumShuffles;
  });
  const shuffleTotal = plays + shuffles;

  return {
    albums: topKeys(albumScores, 14),
    artists: topKeys(artistScores, 14),
    genres: topKeys(genreScores, 12),
    shuffleBias: shuffleTotal > 4 ? clamp(shuffles / shuffleTotal) : 0.35,
  };
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
      albums.set(id, existing ? { ...existing, ...Object.fromEntries(
        Object.entries(album).filter(([, value]) => value !== undefined && value !== null),
      ) } as AlbumRecord : album);
    }
  }
  return [...albums.values()];
};

const genreOverlap = (left: readonly string[], right: readonly string[]) => {
  if (!left.length || !right.length) return 0;
  const other = new Set(right);
  const common = left.filter((genre) => other.has(genre)).length;
  return common / (new Set([...left, ...right]).size || 1);
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

const reasonFor = (
  item: ScoredAlbum,
  seeds: TasteSeeds,
  adventurousness = 0,
) => {
  const { album, signals } = item;
  const artist = album.artist?.trim() || "this artist";
  const genre = formatGenre(album);
  // Explanations lead with what is actually driving the pick. Unplayed material
  // is described as such rather than borrowing the language of familiarity,
  // which is what previously made a discovery shelf read like a repeat of
  // records the listener already knew.
  if (signals.favorite >= 1) return "Because you saved this album";
  if (signals.overlooked > 0.7 && signals.tasteFit >= 0.15)
    return `Overlooked ${genre}, close to your taste`;
  if (signals.exposure === 0) {
    if (signals.cooccurrence >= 0.3 || signals.coengagement >= 0.3)
      return "Close to what you play, with no recorded listens";
    if (signals.context >= 0.5) return `Unplayed ${genre}, close to what you have on now`;
    if (adventurousness >= 0.6) return `A lesser-played ${genre} discovery`;
    return "In your collection, with no recorded listens";
  }
  if (signals.exposure <= 0.25 && adventurousness >= 0.4) {
    if (signals.history > 0.4) return `You liked ${artist}, but barely played this`;
    return `A ${genre} record you have only brushed past`;
  }
  if (signals.engagement >= 0.6 && signals.engagementArtist >= 0.5)
    return `You keep coming back to ${artist}`;
  if (signals.engagement >= 0.55) return "From an album you engaged with";
  if (signals.context > 0.72 && item.artistKey) return `More from ${artist}`;
  if (signals.time > 0.72) return "A fit for your listening time";
  if (signals.coengagement >= 0.5 || signals.cooccurrence >= 0.5)
    return "Because it sits beside what you play";
  if (signals.search >= 0.6) return "Matches what you have searched for";
  if (signals.rediscovery >= 0.55) return "A favorite you have not visited in a while";
  if (signals.history > 0.72) return "From your listening history";
  if (signals.replay >= 0.6) return `A ${artist} record you replay`;
  if (signals.frequent >= 0.58) return "From your heavy rotation";
  if (signals.recent >= 0.58) return "A familiar record you may want back";
  if (signals.genre >= 0.58) return `Because you play ${genre}`;
  if (signals.freshness >= 0.62) return "A new arrival in your collection";
  if (signals.exposure >= 0.6) return `A ${artist} album you have played a lot`;
  if (signals.novelty >= 0.6 && seeds.genres.length)
    return `A different corner of ${genre}`;
  return "A fresh turn from your collection";
};

/**
 * Rank album candidates for the Home shelf.
 *
 * This is intentionally a small hybrid recommender rather than a pretend ML
 * model. It combines server-ranked implicit feedback, explicit favorites,
 * content metadata, short-term queue context, first-party engagement, learned
 * item-to-item similarity, a locally trained re-ranker, exposure-gated
 * discovery, and a maximal-marginal-relevance-style diversity pass. The
 * function is pure so it can be evaluated cheaply with useMemo and tested
 * independently of React.
 */
export function rankAlbumRecommendations(
  input: AlbumRecommendationInput,
): AlbumRecommendation[] {
  const limit = Math.max(0, Math.trunc(input.limit ?? 8));
  if (!limit) return [];
  const now = input.now || new Date();
  const tuning = normalizeRecommendationTuning(
    input.tuning || DEFAULT_RECOMMENDATION_TUNING,
  );
  const weights = recommendationTuningWeights(tuning);
  const { value: normalizedMapValue, genres: normalizedGenreValue } = affinityLookup();
  const normalizedAffinity = normalizedMapValue;
  const normalizedGenreAffinity = normalizedGenreValue;
  const profile = buildProfile(input);
  const seeds = buildSeeds(input, profile, now);
  const engagement = input.engagementProfile;
  const excluded = new Set(input.excludeAlbumIds || []);
  const listeningProfile = input.listeningProfile;
  const hour = now.getHours();
  const weekday = now.getDay();
  const daypart = daypartForHour(hour);
  const currentAlbumId = input.contextSongs?.[0]?.albumId;
  const tasteYear =
    profile.yearWeight > 0 ? profile.yearTotal / profile.yearWeight : null;
  const seedAlbums = seeds.albums.slice(0, 8);
  const seedArtists = seeds.artists.slice(0, 8);
  // Risk appetite drives the relevance/discovery tradeoff. Hoisted here because
  // both the per-candidate discovery score and the final blend need it.
  const adventure = tuning.adventurousness;
  // The curve is deliberately superlinear: low settings barely loosen the
  // shelf, while the top of the range commits fully to discovery. A straight
  // line made every mid preset behave like Explorer and left the dials feeling
  // like they did nothing.
  const discoveryWeight = Math.pow(adventure, 1.5);

  const scored: ScoredAlbum[] = mergeAlbums([
    input.candidates,
    input.discoveryCandidates || [],
    // Retrieval: the library pool widens the candidate set from "whatever the
    // server put on the home page" to the whole collection, which is what makes
    // real discovery possible. Scoring is cheap and pure, so we can afford it.
    input.libraryPool || [],
  ])
    // Explicit mutes remain hard exclusions, including on small libraries.
    .filter((album) => !excluded.has(albumKey(album)) && !engagement?.mutes.has(`artist:${artistKey(album)}`))
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

      const albumStats = listeningProfile?.albums.get(id);
      const artistStats = listeningProfile?.artists.get(artist);
      const history = statAffinity(albumStats, now);
      const historyArtist = statAffinity(artistStats, now);
      const historyGenre = Math.max(
        ...genres.map((genre) => statAffinity(listeningProfile?.genres.get(genre), now)),
        0,
      );
      const historicalTaste = Math.max(history, historyArtist, historyGenre);

      const time = Math.max(
        contextAffinity(listeningProfile?.byDaypart.get(daypart), "albums", id, now),
        contextAffinity(listeningProfile?.byHour.get(hour), "albums", id, now) * 0.92,
        contextAffinity(listeningProfile?.byWeekday.get(weekday), "albums", id, now) * 0.78,
      );
      const transition = transitionAffinity(listeningProfile, currentAlbumId, id);

      const candidateTrackSeconds =
        album.duration && album.songCount ? album.duration / album.songCount : 0;
      const duration =
        candidateTrackSeconds > 0 && listeningProfile?.averageTrackSeconds
          ? clamp(
              1 -
                Math.abs(candidateTrackSeconds - listeningProfile.averageTrackSeconds) / 120,
            )
          : 0;
      const skipPenalty = albumStats
        ? clamp(albumStats.earlySkips / (albumStats.starts + 3))
        : 0;
      const artistSkipPenalty = artistStats
        ? clamp(artistStats.earlySkips / (artistStats.starts + 8))
        : 0;

      const era =
        tasteYear !== null && Number.isFinite(album.year)
          ? clamp(1 - Math.abs(album.year! - tasteYear) / 28)
          : 0;

      // Where in the session the user tends to abandon this artist/album.
      const abandonment = Math.max(
        albumStats?.averagePositionRatio || 0,
        artistStats?.averagePositionRatio || 0,
      );
      const loyalty = clamp(
        Math.max(
          albumStats ? albumStats.distinctDays / 8 : 0,
          artistStats ? artistStats.distinctDays / 12 : 0,
        ),
      );
      const replay = artistStats
        ? clamp((artistStats.starts - artistStats.sessions) / Math.max(1, artistStats.starts))
        : 0;
      const rediscovery = clamp(
        (albumAffinity * 0.5 + recent * 0.5) * (recent > 0 && recent < 0.2 ? 1 : 0.35),
      );

      // Explicit engagement for this album, its artist, or its genres.
      const engagementAlbum = normalizedAffinity(engagement?.albumAffinity, id);
      const engagementArtist = normalizedAffinity(engagement?.artistAffinity, artist);
      const engagementGenre = normalizedGenreAffinity(engagement?.genreAffinity, genres);
      const engagementScore = Math.max(
        engagementAlbum,
        engagementArtist * 0.7,
        engagementGenre * 0.5,
      );
      const aversion = Math.max(
        normalizedAffinity(engagement?.albumAversion, id),
        normalizedAffinity(engagement?.artistAversion, artist),
        normalizedGenreAffinity(engagement?.genreAversion, genres),
        skipPenalty * 0.5,
        artistSkipPenalty * 0.4,
        abandonment > 0.85 ? 0.35 : 0,
      );
      const search = keywordAffinity(
        engagement,
        `${album.name || album.title || ""} ${album.artist || ""} ${album.genre || ""}`,
      );

      const cooccurrence = bestCosine(
        listeningProfile?.albumCooccurrence,
        seedAlbums.filter((seed) => seed !== id),
        id,
      );
      const coengagement = Math.max(
        ...seedAlbums
          .filter((seed) => seed !== id)
          .map((seed) => coengagementSimilarity(engagement, seed, id)),
        0,
      );
      const artistCooccurrence = bestCosine(
        listeningProfile?.artistCooccurrence,
        seedArtists.filter((seed) => seed !== artist),
        artist,
      );

      const familiarity = clamp(
        artistAffinity * 0.4 +
          genreAffinity * 0.32 +
          albumAffinity * 0.18 +
          historicalTaste * 0.3 +
          engagementScore * 0.25,
      );
      const novelty = clamp(1 - familiarity);
      const recentPenalty = recent * 0.17;

      // ---- Exposure: how much of this the listener has already consumed.
      // Tracked separately from taste, because "you already play this to death"
      // and "you would like this" are different questions. Without this, raised
      // risk appetite could only ever reshuffle records already in rotation.
      //
      // Neither artist familiarity nor genre taste proves album consumption.
      // Album-specific consumption only. Saves, views, and other albums by
      // this artist are not listens. One album pass is not heavy rotation.
      const albumSeconds = album.duration && album.duration > 0 ? album.duration : 2400;
      const albumTracks = album.songCount && album.songCount > 0 ? album.songCount : 10;
      const localPasses = (albumStats?.listenedSeconds || 0) / albumSeconds;
      const serverPlays = Number.isFinite(album.playCount) ? Math.max(0, album.playCount!) : 0;
      const exposure = clamp(Math.max(
        1 - Math.exp(-localPasses / 2),
        // Starts are weak evidence when playback never progresses.
        Math.min(0.25, (albumStats?.starts || 0) / (albumTracks * 8)),
        1 - Math.exp(-serverPlays / 4),
        recent > 0 ? 0.12 : 0,
        frequent > 0 ? 0.35 + frequent * 0.35 : 0,
      ));
      const seen = engagement?.albums.get(normalize(id));
      const impressions = seen?.impressions || 0;
      const views = seen?.views || 0;
      const overlooked = (1 - exposure) / Math.sqrt(1 + views + impressions);
      const shownAgeDays = seen?.lastShownAt
        ? Math.max(0, (now.getTime() - seen.lastShownAt) / 86_400_000) : Infinity;
      // Temporary shelf fatigue, not a dislike. It recovers with time and is
      // discounted when the listener actively chose this album afterward.
      const actedSinceShown = Boolean(seen && seen.lastAt > seen.lastShownAt);
      const fatigue = (1 - Math.exp(-impressions / 3)) *
        Math.exp(-shownAgeDays / 3) * (actedSinceShown ? 0.25 : 1);
      // A softened gate: anything not worn out stays discovery-eligible, and
      // proven affinity breaks ties. A hard multiplier here meant a lightly
      // played album you clearly liked lost to a completely untouched one.
      const unexposed = Math.sqrt(clamp(1 - exposure));

      // ---- Discovery: fits your taste, but you have not actually heard it.
      // The `unexposed` gate is what makes high risk appetite reach genuinely
      // new material instead of reshuffling heavy rotation.
      const tasteFit = clamp(
        artistAffinity * 0.26 +
          genreAffinity * 0.24 +
          historicalTaste * 0.18 +
          engagementScore * 0.16 +
          cooccurrence * 0.2 +
          coengagement * 0.16 +
          artistCooccurrence * 0.14 +
          era * 0.06 +
          duration * 0.05 +
          search * 0.08,
      );
      // Even Explorer retains relevance. Uncertainty earns a bounded bonus,
      // rather than letting daily random noise dominate musical fit.
      const discovery = unexposed * (
        tasteFit * (0.85 - adventure * 0.2) +
        overlooked * 0.2 +
        novelty * adventure * 0.08 +
        stableRotation(id, now) * (0.025 + adventure * 0.055)
      );

      const priorScore =
        artistAffinity * 0.24 * weights.artist +
        genreAffinity * 0.19 * weights.genre +
        albumAffinity * 0.1 * weights.album +
        frequent * 0.1 * weights.frequent +
        recent * 0.06 * weights.recent +
        favorite * 0.12 * weights.favorite +
        context * 0.11 +
        freshness * 0.05 * weights.freshness +
        era * 0.03 * weights.era +
        historicalTaste * 0.17 * weights.history +
        time * 0.1 +
        transition * 0.08 +
        duration * 0.03 +
        engagementScore * 0.2 * weights.engagement +
        engagementArtist * 0.12 * weights.engagement +
        engagementGenre * 0.09 * weights.engagement +
        search * 0.07 +
        cooccurrence * 0.14 * weights.cooccurrence +
        coengagement * 0.12 * weights.cooccurrence +
        artistCooccurrence * 0.08 * weights.cooccurrence +
        loyalty * 0.06 * weights.loyalty +
        replay * 0.05 * weights.replay +
        rediscovery * 0.04 * weights.rediscovery -
        recentPenalty * weights.recentPenalty -
        skipPenalty * 0.16 * weights.skipPenalty -
        aversion * 0.3 * weights.aversion;

      // A shuffle-heavy listener wants breadth; an album listener wants
      // continuity. Nudge discovery in the direction they actually behave.
      const discoveryBias =
        seeds.shuffleBias * 0.05 * (0.4 + novelty) -
        (1 - seeds.shuffleBias) * 0.02 * novelty;
      const signals: RecommendationSignals = {
        artist: artistAffinity,
        genre: genreAffinity,
        album: albumAffinity,
        recent,
        frequent,
        favorite,
        context,
        freshness,
        era,
        history: historicalTaste,
        time,
        transition,
        duration,
        skipPenalty,
        engagement: engagementScore,
        engagementArtist,
        engagementGenre,
        search,
        aversion,
        cooccurrence,
        coengagement,
        loyalty,
        replay,
        rediscovery,
        novelty,
        exposure,
        discovery,
        overlooked,
        fatigue,
        tasteFit,
        learned: 0,
      };
      const features: FeatureVector = signals;
      const relevance = priorScore + discoveryBias;
      // Worn-out records are demoted rather than removed. A penalty keeps the
      // shelf full on small libraries while still making heavy rotation lose
      // to genuinely unplayed material whenever there is any to show.
      const rotationPenalty =
        exposure >= ROTATION_EXPOSURE
          ? discoveryWeight * ROTATION_PENALTY
          : 0;
      const base =
        relevance * (1 - discoveryWeight) +
        discovery * discoveryWeight -
        rotationPenalty + overlooked * (0.04 + adventure * 0.12) -
        fatigue * (0.12 + adventure * 0.18) -
        // Negative feedback survives the discovery blend, even at risk=100%.
        aversion * discoveryWeight * 0.35 * weights.aversion;
      const learned =
        (blendLearnedScore(base, input.rankerModel, features) - base) *
        weights.learned;
      signals.learned = learned;
      const item: ScoredAlbum = {
        album,
        score: base + learned,
        exposure,
        reason: "",
        signals,
        features,
        artistKey: artist,
        genreKeys: genres,
      };
      item.reason = reasonFor(item, seeds, tuning.adventurousness);
      return item;
    });

  if (!scored.length) return [];

  const remaining = [...scored];
  // Reserve discovery opportunities at every preset, provided taste evidence
  // exists. Never force disliked or unrelated albums merely to meet a quota.
  const discoveryTarget = Math.round(Math.min(limit, scored.length) * adventure * 0.75);
  let discoveries = 0;
  const genreCounts = new Map<string, number>();
  const genreTaste = new Map(profile.genres);
  listeningProfile?.genres.forEach((stats, genre) => add(genreTaste, genre, statAffinity(stats, now)));
  engagement?.genreAffinity.forEach((value, genre) => add(genreTaste, genre, value));
  const genreTotal = [...genreTaste.values()].reduce((total, value) => total + value, 0);
  const discoveryEligible = (item: ScoredAlbum) => item.exposure < 0.3 &&
    item.signals.aversion < 0.35 && (item.signals.tasteFit >= 0.08 || !genreTotal);

  const selected: ScoredAlbum[] = [];
  const artistCounts = new Map<string, number>();
  while (remaining.length && selected.length < limit) {
    const needsDiscovery = discoveries < discoveryTarget &&
      limit - selected.length <= discoveryTarget - discoveries && remaining.some(discoveryEligible);
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      if (needsDiscovery && !discoveryEligible(candidate)) continue;
      const redundancy = selected.length
        ? Math.max(...selected.map((item) => similarity(candidate, item)))
        : 0;
      const artistCount = candidate.artistKey ? artistCounts.get(candidate.artistKey) || 0 : 0;
      // Give underrepresented taste genres some space without demanding an
      // exact histogram or treating all music as one average release year.
      const coverage = genreTotal > 0 ? candidate.genreKeys.reduce((sum, genre) => {
        const target = (genreTaste.get(genre) || 0) / genreTotal;
        const actual = (genreCounts.get(genre) || 0) / Math.max(1, selected.length);
        return sum + Math.max(0, target - actual);
      }, 0) : 0;
      // Soft taxes, not hard bans: a second album by the same artist is allowed
      // when it genuinely outranks the alternatives, and every candidate stays
      // eligible so the shelf always fills when the library is small.
      const value =
        candidate.score + coverage * 0.16 * weights.diversity -
        redundancy * 0.14 * weights.diversity -
        artistCount * 0.11 * weights.diversity;
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
    if (discoveryEligible(best)) discoveries += 1;
    best.genreKeys.forEach((genre) => genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1 / best.genreKeys.length));
    artistCounts.set(best.artistKey, (artistCounts.get(best.artistKey) || 0) + 1);
  }

  return selected.map(
    ({ artistKey: _artistKey, genreKeys: _genreKeys, ...item }) => item,
  );
}

/**
 * Turn a list of songs into one-track album candidates.
 *
 * The Settings preview mixes these with the album pool so the live list covers
 * songs as well as albums. Deduped by album ID, so a song whose album is
 * already a candidate simply merges into it.
 */
export function songAlbumCandidates(songs: readonly Song[]): AlbumRecord[] {
  const seen = new Set<string>();
  const candidates: AlbumRecord[] = [];
  for (const song of songs) {
    const id = (song.albumId || song.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    candidates.push({
      id,
      name: song.album || song.title,
      artist: song.artist || song.albumArtist,
      artistId: song.artistId,
      coverArt: song.coverArt,
      year: song.year,
      genre: song.genre,
      songCount: 1,
      duration: song.duration,
      source: song.source,
      localArtworkUrl: song.localArtworkUrl,
    });
  }
  return candidates;
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

/**
 * The seed artist IDs the listener cares about most, best-first. Used by the
 * app to fetch a little extra personalized discovery material (albums by these
 * artists) that the server's generic lists would never surface.
 */
export function topArtistSeeds(
  input: Pick<
    AlbumRecommendationInput,
    "listeningProfile" | "engagementProfile" | "now"
  >,
  limit = 3,
): string[] {
  const now = input.now || new Date();
  const engagement = input.engagementProfile;
  const scores = new Map<string, number>();
  input.listeningProfile?.artists.forEach((stats, key) => {
    // Artist IDs are opaque; normalized names may contain spaces. Only trust
    // keys that look like server IDs so we never fetch on a name by mistake.
    if (!key || key.includes(" ")) return;
    add(scores, key, statAffinity(stats, now) * (1 + Math.log1p(stats.starts)));
  });
  if (engagement?.artistAffinity.size) {
    let maximum = 0;
    for (const value of engagement.artistAffinity.values())
      maximum = Math.max(maximum, value);
    if (maximum > 0)
      engagement.artistAffinity.forEach((value, key) => {
        if (!key || key.includes(" ")) return;
        add(scores, key, (value / maximum) * 1.3 + value * 0.05);
      });
  }
  return topKeys(scores, Math.max(0, Math.trunc(limit)));
}
