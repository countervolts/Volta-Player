import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownWideNarrow,
  Ban,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Disc3,
  Eye,
  EyeOff,
  FolderOpen,
  Grid2X2,
  Info,
  ListEnd,
  ListPlus,
  House,
  ListMusic,
  LoaderCircle,
  Mic2,
  Music2,
  PanelLeft,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Shuffle,
  Star,
  ThumbsDown,
  UserRound,
  X,
} from "lucide-react";
import {
  Navidrome,
  albumName,
  duration,
  isConnectionFailure,
  isLocalSong,
  isLossless,
  serverCandidates,
  shuffleSongs,
  type AlbumRecord,
  type Artist,
  type Credentials,
  type Playlist,
  type Song,
} from "./lib/navidrome";
import {
  chooseLocalDirectory,
  clearLocalDirectoryHandle,
  localLibraryFromFileList,
  releaseLocalMusicLibrary,
  restoreLocalMusicDirectory,
  supportsDirectoryPicker,
  type LocalMusicLibrary,
} from "./lib/local-music";
import { usePlayer, type PlaybackSession } from "./lib/use-player";
import {
  AlbumGrid,
  Artwork,
  ArtworkMotionProvider,
  cancelArtworkPrefetches,
  ContextMenu,
  EmptyState,
  IconButton,
  InfiniteScrollSentinel,
  LoadingState,
  Modal,
  prefetchArtwork,
  TrackTable,
  type ContextMenuItem,
} from "./components";
import { FullPlayer, Inspector, PlaybackDock } from "./player-ui";
import { SearchGenres } from "./search-genres";
import {
  favoriteAlbumIdsFromSongs,
  mergeRecommendationCandidates,
  rankAlbumRecommendations,
  topArtistSeeds,
} from "./lib/recommendations";
import {
  appendListeningEvent,
  clearListeningHistory,
  listeningHistoryKey,
  readListeningHistory,
  summarizeListening,
  writeListeningHistory,
  type ListeningEvent,
  type ListeningProfile,
} from "./lib/listening-history";
import {
  appendEngagement,
  clearEngagement,
  createEngagementEvent,
  engagementStorageKey,
  readEngagement,
  summarizeEngagement,
  type EngagementEntity,
  type EngagementEvent,
  type EngagementEventInput,
  type EngagementProfile,
} from "./lib/interactions";
import {
  attributeReward,
  clearRankerState,
  emptyRankerModel,
  impressionStorageKey,
  rankerConfidence,
  rankerModelStorageKey,
  readImpressions,
  readRankerModel,
  trainRanker,
  writeImpressions,
  writeRankerModel,
  type PendingImpression,
  type RankerExample,
  type RankerModel,
  type RewardTarget,
} from "./lib/learned-ranker";
import {
  bindingFromKeyboardEvent,
  bindingSignature,
  formatShortcut,
  readShortcutBindings,
  SHORTCUT_DEFINITIONS,
  SHORTCUT_STORAGE_KEY,
  shortcutMatches,
  platformModifierLabel,
  type ShortcutBindings,
  type ShortcutId,
} from "./shortcuts";
import "./version-handoff";

type Page =
  | "home"
  | "recent"
  | "played"
  | "albums"
  | "artists"
  | "songs"
  | "favorites"
  | "playlists"
  | "search"
  | "genre"
  | "album"
  | "artist"
  | "playlist"
  | "settings";
type Route = { page: Page; id?: string; title?: string };
type ContextTarget =
  | { type: "song"; item: Song; x: number; y: number }
  | { type: "album"; item: AlbumRecord; x: number; y: number };
type PlaylistDraft = {
  playlist?: Playlist;
  song?: Song;
  name: string;
};
type PageData = {
  albums: AlbumRecord[];
  recent: AlbumRecord[];
  recentlyPlayed: AlbumRecord[];
  frequent: AlbumRecord[];
  recommendationCandidates: AlbumRecord[];
  favoriteAlbumIds: string[];
  songs: Song[];
  artists: Artist[];
  playlists: Playlist[];
  album?: AlbumRecord;
  artist?: Artist;
  playlist?: Playlist;
  similarAlbums: AlbumRecord[];
  similarArtists: Artist[];
};
const EMPTY: PageData = {
  albums: [],
  recent: [],
  recentlyPlayed: [],
  frequent: [],
  recommendationCandidates: [],
  favoriteAlbumIds: [],
  songs: [],
  artists: [],
  playlists: [],
  similarAlbums: [],
  similarArtists: [],
};
const SEARCH_ARTIST_PAGE_SIZE = 30;
const SEARCH_ALBUM_PAGE_SIZE = 50;
const SEARCH_SONG_PAGE_SIZE = 100;
const pageHasMore = (page: Page, data: PageData) =>
  page === "albums" || page === "recent" || page === "played"
    ? data.albums.length === 60
    : page === "songs"
      ? data.songs.length === 100
      : page === "search"
        ? data.artists.length === SEARCH_ARTIST_PAGE_SIZE ||
          data.albums.length === SEARCH_ALBUM_PAGE_SIZE ||
          data.songs.length === SEARCH_SONG_PAGE_SIZE
        : false;
const LIBRARY_CACHE_TTL = 15 * 60 * 1000;
const libraryCacheKey = (server: string, username: string, loadKey: string) =>
  `volta-library-cache:${encodeURIComponent(server)}:${encodeURIComponent(username)}:${encodeURIComponent(loadKey)}`;
const normalizeCachedPageData = (value: Partial<PageData>): PageData => ({
  ...EMPTY,
  albums: Array.isArray(value.albums) ? value.albums : [],
  recent: Array.isArray(value.recent) ? value.recent : [],
  recentlyPlayed: Array.isArray(value.recentlyPlayed)
    ? value.recentlyPlayed
    : [],
  frequent: Array.isArray(value.frequent) ? value.frequent : [],
  recommendationCandidates: Array.isArray(value.recommendationCandidates)
    ? value.recommendationCandidates
    : [],
  favoriteAlbumIds: Array.isArray(value.favoriteAlbumIds)
    ? value.favoriteAlbumIds.filter((id): id is string => typeof id === "string")
    : [],
  songs: Array.isArray(value.songs) ? value.songs : [],
  artists: Array.isArray(value.artists) ? value.artists : [],
  playlists: Array.isArray(value.playlists) ? value.playlists : [],
  album: value.album,
  artist: value.artist,
  playlist: value.playlist,
  similarAlbums: Array.isArray(value.similarAlbums) ? value.similarAlbums : [],
  similarArtists: Array.isArray(value.similarArtists)
    ? value.similarArtists
    : [],
});
const readCachedPageData = (
  server: string,
  username: string,
  loadKey: string,
): PageData | null => {
  try {
    const value = JSON.parse(
      safeRead(sessionStorage, libraryCacheKey(server, username, loadKey)),
    ) as { savedAt?: unknown; data?: Partial<PageData> };
    if (
      !value ||
      typeof value.savedAt !== "number" ||
      !value.data ||
      Date.now() - value.savedAt > LIBRARY_CACHE_TTL
    )
      return null;
    return normalizeCachedPageData(value.data);
  } catch {
    return null;
  }
};
const writeCachedPageData = (
  server: string,
  username: string,
  loadKey: string,
  data: PageData,
) => {
  try {
    safeWrite(
      sessionStorage,
      libraryCacheKey(server, username, loadKey),
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch {
    /* Session storage is optional and quota-limited. */
  }
};
const preparePageArtwork = async (
  client: Navidrome,
  data: PageData,
  page: Page,
) => {
  const jobs: Promise<void>[] = [];
  const addAlbums = (albums: AlbumRecord[], size: number) =>
    albums.slice(0, 120).forEach((album) => {
      if (album.coverArt)
        jobs.push(prefetchArtwork(client, album.coverArt, undefined, size));
    });
  addAlbums(data.albums, page === "home" ? 600 : 400);
  addAlbums(data.recent, 400);
  addAlbums(data.recentlyPlayed, 400);
  addAlbums(data.frequent, 400);
  addAlbums(data.recommendationCandidates, 400);
  addAlbums(data.similarAlbums, 400);
  data.artists.slice(0, 120).forEach((artist) => {
    if (artist.coverArt || artist.artistImageUrl)
      jobs.push(
        prefetchArtwork(
          client,
          artist.coverArt,
          artist.artistImageUrl,
          300,
        ),
      );
  });
  data.songs.slice(0, 160).forEach((song) => {
    if (song.coverArt)
      jobs.push(prefetchArtwork(client, song.coverArt, undefined, 80));
  });
  if (data.artist?.coverArt || data.artist?.artistImageUrl)
    jobs.push(
      prefetchArtwork(
        client,
        data.artist.coverArt,
        data.artist.artistImageUrl,
        400,
      ),
    );
  if (data.album?.coverArt)
    jobs.push(prefetchArtwork(client, data.album.coverArt, undefined, 700));
  if (data.playlist?.coverArt)
    jobs.push(prefetchArtwork(client, data.playlist.coverArt, undefined, 700));
  await Promise.allSettled(jobs);
};
const TITLES: Record<Page, string> = {
  home: "Home",
  recent: "Recently Added",
  played: "Recently Played",
  albums: "Albums",
  artists: "Artists",
  songs: "Songs",
  favorites: "Favorite Songs",
  playlists: "Playlists",
  search: "Search",
  genre: "Genre",
  album: "Album",
  artist: "Artist",
  playlist: "Playlist",
  settings: "Settings",
};
const safeRead = (storage: Storage, key: string) => {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
};
const safeWrite = (storage: Storage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
};
const safeRemove = (storage: Storage, key: string) => {
  try {
    storage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
};
const LOCAL_FAVORITES_KEY = "volta-local-favorites";
const readLocalFavorites = (): Record<string, boolean> => {
  try {
    const value = JSON.parse(safeRead(localStorage, LOCAL_FAVORITES_KEY));
    return value && typeof value === "object"
      ? (Object.fromEntries(
          Object.entries(value)
            .filter(([key, item]) => key.startsWith("local:") && item === true)
            .map(([key]) => [key, true]),
        ) as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
};
const REMEMBERED_CREDENTIALS_KEY = "volta-remembered-credentials";
const SESSION_CREDENTIALS_KEY = "volta-session-credentials";
const INTERFACE_SCALE_KEY = "volta-interface-scale";
const EXTERNAL_LYRICS_KEY = "volta-external-lyrics";
const INFINITE_PLAY_COUNT_KEY = "volta-infinite-play-count";
const INFINITE_PLAY_MODE_KEY = "volta-infinite-play-mode";
const INFINITE_PLAY_ENABLED_KEY = "volta-infinite-play-enabled";
type InfinitePlayMode = "algorithm" | "random";
const LISTENING_HISTORY_ENABLED_KEY = "volta-listening-history-enabled";
const LISTENING_HISTORY_PERSIST_KEY = "volta-listening-history-persist";
const clampInterfaceScale = (value: number) =>
  Math.min(150, Math.max(70, Math.round(value)));
const readInterfaceScale = () => {
  const value = Number(safeRead(localStorage, INTERFACE_SCALE_KEY));
  return Number.isFinite(value) && value >= 70 && value <= 150
    ? clampInterfaceScale(value)
    : 100;
};
const LOGIN_DRAFT_KEY = "volta-login-draft";
type LoginDraft = { server: string; username: string };
const readLoginDraft = (): LoginDraft => {
  try {
    const value = JSON.parse(
      safeRead(sessionStorage, LOGIN_DRAFT_KEY),
    ) as Partial<LoginDraft>;
    const draft = {
      server: typeof value.server === "string" ? value.server : "",
      username: typeof value.username === "string" ? value.username : "",
    };
    // Rewrite legacy drafts immediately so a previously stored raw password is
    // removed before the sign-in form becomes interactive.
    safeWrite(sessionStorage, LOGIN_DRAFT_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    safeRemove(sessionStorage, LOGIN_DRAFT_KEY);
    return { server: "", username: "" };
  }
};
type StoredCredentials = {
  server: string;
  username: string;
  auth: { salt: string; token: string };
};
const readStoredCredentials = (
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
const readRememberedCredentials = () =>
  readStoredCredentials(localStorage, REMEMBERED_CREDENTIALS_KEY);
const readSessionCredentials = () =>
  readStoredCredentials(sessionStorage, SESSION_CREDENTIALS_KEY);
const libraryPathKey = (server: string, username: string, suffix: string) =>
  `volta-private-path:${encodeURIComponent(server)}:${encodeURIComponent(username)}:${suffix}`;
const localLibraryPathKey = (suffix: string) =>
  libraryPathKey("local", "local-library", suffix);
const lastPlayedSongKey = (server: string, username: string) =>
  `volta-last-played:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;
const volumeKey = (server: string, username: string) =>
  `volta-volume:${encodeURIComponent(server)}:${encodeURIComponent(username)}`;
const localPlaybackKey = (directoryName: string) =>
  `volta-local-last-played:${encodeURIComponent(directoryName)}`;
const localVolumeKey = (directoryName: string) =>
  `volta-local-volume:${encodeURIComponent(directoryName)}`;
const LOCAL_SOURCE_MODE_KEY = "volta-source-mode";
const SEARCH_HISTORY_KEY = "volta-search-history";
/** How long after a shelf impression an action can still be credited to it. */
const REWARD_WINDOW_MS = 6 * 60 * 60 * 1000;
const splitGenres = (value?: string) =>
  (value || "")
    .split(/[,;|/]+/)
    .map((genre) => genre.trim())
    .filter(Boolean);
const engagementEntityForSong = (song: Song): EngagementEntity => ({
  type: "song",
  id: song.id,
  name: song.title,
  artistId: song.artistId || song.albumArtist,
  artistName: song.artist,
  albumId: song.albumId,
  albumName: song.album,
  genre: song.genre,
});
const engagementEntityForAlbum = (album: AlbumRecord): EngagementEntity => ({
  type: "album",
  id: album.id,
  name: albumName(album),
  artistId: album.artistId,
  artistName: album.artist,
  genre: album.genre,
  year: album.year,
});
const rewardTargetForSong = (song: Song): RewardTarget => ({
  albumId: song.albumId,
  artistId: song.artistId || song.albumArtist,
  genres: splitGenres(song.genre),
});
const rewardTargetForAlbum = (album: AlbumRecord): RewardTarget => ({
  albumId: album.id,
  artistId: album.artistId,
  genres: splitGenres(album.genre),
});
/**
 * Convert a playback event into a learning signal. Completing a song is the
 * strongest positive; an early skip is the strongest negative.
 */
const playbackReward = (event: ListeningEvent) => {
  switch (event.kind) {
    case "start":
      return 0.5;
    case "resume":
      return 0.15;
    case "complete":
      return 0.9;
    case "skip":
      return -0.5 - (1 - event.completionRatio) * 0.4;
    case "stop":
      return event.completionRatio > 0.5 ? 0.2 : -0.2;
    default:
      return 0;
  }
};
const readSearchHistory = (): string[] => {
  try {
    const value = JSON.parse(safeRead(localStorage, SEARCH_HISTORY_KEY));
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
};
const readPlaybackSession = (
  server: string,
  username: string,
): PlaybackSession | null => {
  try {
    const value = JSON.parse(
      safeRead(localStorage, lastPlayedSongKey(server, username)),
    ) as Partial<PlaybackSession> & Partial<Song> & {
      song?: Partial<Song>;
      timestamp?: unknown;
    };
    const legacySong =
      value.song && typeof value.song === "object" ? value.song : value;
    const legacyQueue =
      legacySong &&
      typeof legacySong.id === "string" &&
      typeof legacySong.title === "string" &&
      !isLocalSong(legacySong as Song)
        ? [legacySong as Song]
        : [];
    const queue = Array.isArray(value.queue)
      ? value.queue.filter(
          (song): song is Song =>
            Boolean(song) &&
            typeof song === "object" &&
            typeof song.id === "string" &&
            typeof song.title === "string" &&
            !isLocalSong(song),
        )
      : legacyQueue;
    if (!queue.length) return null;
    const repeat = ["off", "all", "one"].includes(String(value.repeat))
      ? (value.repeat as PlaybackSession["repeat"])
      : "off";
    return {
      queue,
      currentIndex:
        typeof value.currentIndex === "number" &&
        Number.isFinite(value.currentIndex)
          ? Math.max(0, Math.min(queue.length - 1, Math.trunc(value.currentIndex)))
          : 0,
      position:
        typeof value.position === "number" && Number.isFinite(value.position)
          ? Math.max(0, value.position)
          : typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
            ? Math.max(0, value.timestamp)
            : 0,
      shuffle: Boolean(value.shuffle),
      repeat,
      original: value.original !== false,
      wasPlaying: Boolean(value.wasPlaying),
    };
  } catch {
    return null;
  }
};
const readVolume = (server: string, username: string): number | null => {
  const value = Number(safeRead(localStorage, volumeKey(server, username)));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
};
const readLocalVolume = (directoryName: string): number | null => {
  const value = Number(safeRead(localStorage, localVolumeKey(directoryName)));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
};
const readLocalPlaybackSession = (
  library: LocalMusicLibrary,
): PlaybackSession | null => {
  try {
    const value = JSON.parse(
      safeRead(localStorage, localPlaybackKey(library.directoryName)),
    ) as Partial<PlaybackSession>;
    if (!Array.isArray(value.queue)) return null;
    const savedQueue = value.queue.filter(
      (song): song is Song =>
        Boolean(song) &&
        typeof song === "object" &&
        typeof song.id === "string" &&
        typeof song.title === "string",
    );
    const tracksById = new Map(library.tracks.map((song) => [song.id, song]));
    const queue = savedQueue
      .map((song) => tracksById.get(song.id))
      .filter((song): song is Song => Boolean(song));
    if (!queue.length) return null;
    const savedCurrentId = savedQueue[value.currentIndex || 0]?.id;
    const savedCurrentIndex =
      savedCurrentId === undefined
        ? Number(value.currentIndex)
        : queue.findIndex((song) => song.id === savedCurrentId);
    return {
      queue,
      currentIndex:
        Number.isFinite(savedCurrentIndex) && savedCurrentIndex >= 0
          ? Math.min(queue.length - 1, Math.trunc(savedCurrentIndex))
          : 0,
      position:
        typeof value.position === "number" && Number.isFinite(value.position)
          ? Math.max(0, value.position)
          : 0,
      shuffle: Boolean(value.shuffle),
      repeat: ["off", "all", "one"].includes(String(value.repeat))
        ? (value.repeat as PlaybackSession["repeat"])
        : "off",
      original: value.original !== false,
      wasPlaying: Boolean(value.wasPlaying),
    };
  } catch {
    return null;
  }
};
const serializableLocalPlayback = (snapshot: PlaybackSession): PlaybackSession => ({
  ...snapshot,
  queue: snapshot.queue.map(({ localArtworkUrl, localUrl, ...song }) => song),
});
const randomLibraryPath = () => {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
};
const pathForRoute = (number: string, route: Route, query = "") => {
  if (!number) return "/";
  const segments = [number];
  if (route.page !== "home") segments.push(route.page);
  if (route.id) segments.push(encodeURIComponent(route.id));
  const search =
    route.page === "search" && query.trim()
      ? `?q=${encodeURIComponent(query.trim())}`
      : "";
  return `/${segments.join("/")}${search}`;
};
const fullscreenPath = (number: string) =>
  number ? `/${number}/player` : "/player";
const readBrowserRoute = (
  number: string,
): { route: Route; query: string; fullscreen?: boolean } => {
  if (window.location.pathname === fullscreenPath(number))
    return { route: { page: "home" }, query: "", fullscreen: true };
  if (!number) return { route: { page: "home" }, query: "" };
  const url = new URL(window.location.href);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== number || !segments[1])
    return { route: { page: "home" }, query: "" };
  const page = segments[1] as Page;
  if (!(page in TITLES)) return { route: { page: "home" }, query: "" };
  let id: string | undefined;
  if (segments[2]) {
    try {
      id = decodeURIComponent(segments[2]);
    } catch {
      return { route: { page: "home" }, query: "" };
    }
  }
  if (page === "genre" && !id)
    return { route: { page: "home" }, query: "" };
  return {
    route: { page, id },
    query: page === "search" ? url.searchParams.get("q") || "" : "",
  };
};
const setBrowserPath = (number: string) => {
  window.history.replaceState(
    { voltaRoute: true },
    "",
    number ? `/${number}` : "/",
  );
};
const genreKey = (genre?: string) => genre?.trim().toLowerCase() || "";
const similarAlbumsFor = (
  source: AlbumRecord,
  library: AlbumRecord[],
): AlbumRecord[] => {
  const sourceGenre = genreKey(source.genre);
  return library
    .filter((album) => album.id !== source.id)
    .map((album) => {
      const sameGenre = Boolean(sourceGenre && genreKey(album.genre) === sourceGenre);
      const sameArtist = Boolean(
        source.artistId && album.artistId && source.artistId === album.artistId,
      );
      const yearDistance =
        source.year && album.year ? Math.abs(source.year - album.year) : 100;
      const score =
        (sameGenre ? 100 : 0) +
        (sameArtist ? 25 : 0) +
        Math.max(0, 10 - Math.min(yearDistance, 10));
      return { album, score };
    })
    .filter(({ score, album }) => score > 10 || genreKey(album.genre) === sourceGenre)
    .sort(
      (left, right) =>
        right.score - left.score ||
        albumName(left.album).localeCompare(albumName(right.album)),
    )
    .slice(0, 6)
    .map(({ album }) => album);
};
const similarArtistsFor = (
  source: Artist,
  library: AlbumRecord[],
): Artist[] => {
  const sourceGenres = new Set((source.album || []).map((album) => genreKey(album.genre)).filter(Boolean));
  const sourceId = source.id;
  const candidates = new Map<string, { artist: Artist; score: number }>();
  library.forEach((album) => {
    const artistName = album.artist?.trim();
    const artistId = album.artistId || artistName;
    if (!artistId || artistId === sourceId || !artistName) return;
    const genre = genreKey(album.genre);
    if (!genre || !sourceGenres.has(genre)) return;
    const current = candidates.get(artistId);
    const artist: Artist = current?.artist || {
      id: artistId,
      name: artistName,
      coverArt: album.coverArt,
      albumCount: 0,
    };
    artist.albumCount = (artist.albumCount || 0) + 1;
    candidates.set(artistId, {
      artist,
      score: (current?.score || 0) + 1,
    });
  });
  return [...candidates.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.artist.name.localeCompare(right.artist.name),
    )
    .slice(0, 6)
    .map(({ artist }) => artist);
};

const shuffledAlbums = (albums: AlbumRecord[]) => {
  const result = [...albums];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

const localAlbumOrder = (library: LocalMusicLibrary, sort: string) => {
  if (sort === "newest") return library.recentAlbums;
  if (sort === "alphabeticalByArtist")
    return [...library.albums].sort(
      (left, right) =>
        (left.artist || "").localeCompare(right.artist || "", undefined, {
          sensitivity: "base",
        }) ||
        (left.name || "").localeCompare(right.name || "", undefined, {
          sensitivity: "base",
        }),
    );
  return library.albums;
};

const localPageData = (
  library: LocalMusicLibrary | null,
  route: Route,
  query: string,
  sort: string,
): PageData => {
  const albums = library?.albums || [];
  const recentAlbums = library?.recentAlbums || [];
  const artists = library?.artists || [];
  const songs = library?.tracks || [];
  switch (route.page) {
    case "home":
      return {
        ...EMPTY,
        albums: shuffledAlbums(albums).slice(0, 8),
        recent: recentAlbums.slice(0, 12),
        recommendationCandidates: albums,
      };
    case "recent":
      return { ...EMPTY, albums: recentAlbums };
    case "albums":
      return { ...EMPTY, albums: library ? localAlbumOrder(library, sort) : [] };
    case "artists":
      return { ...EMPTY, artists };
    case "songs":
    case "favorites":
      return { ...EMPTY, songs };
    case "album": {
      const album = albums.find((item) => item.id === route.id);
      return {
        ...EMPTY,
        album,
        songs: album?.song || [],
        similarAlbums: album ? similarAlbumsFor(album, albums) : [],
      };
    }
    case "artist": {
      const artist = artists.find((item) => item.id === route.id);
      return {
        ...EMPTY,
        artist,
        albums: artist?.album || [],
        similarArtists: artist ? similarArtistsFor(artist, albums) : [],
      };
    }
    case "search": {
      const needle = query.trim().toLowerCase();
      if (!needle) return EMPTY;
      return {
        ...EMPTY,
        songs: songs.filter((song) =>
          [song.title, song.artist, song.album].join(" ").toLowerCase().includes(needle),
        ),
        albums: albums.filter((album) =>
          [albumName(album), album.artist].join(" ").toLowerCase().includes(needle),
        ),
        artists: artists.filter((artist) =>
          artist.name.toLowerCase().includes(needle),
        ),
      };
    }
    case "genre":
      return EMPTY;
    case "played":
    case "playlists":
      return EMPTY;
  }
  return EMPTY;
};

const LISTENING_EVENT_LABELS: Record<string, string> = {
  start: "Started",
  resume: "Resumed",
  pause: "Paused",
  skip: "Skipped",
  complete: "Finished",
  stop: "Stopped",
  seek: "Sought",
};

const ENGAGEMENT_EVENT_LABELS: Record<string, string> = {
  "album-view": "Opened album",
  "artist-view": "Opened artist",
  "genre-view": "Browsed genre",
  "favorite-add": "Favorited",
  "favorite-remove": "Unfavorited",
  "queue-add": "Queued",
  "play-next": "Play next",
  "album-play": "Played album",
  "album-shuffle": "Shuffled album",
  "playlist-add": "Added to playlist",
  search: "Searched",
  "recommendation-click": "Opened a suggestion",
  dislike: "Not interested",
  undislike: "Undid not interested",
  "artist-mute": "Muted artist",
  "artist-unmute": "Unmuted artist",
};

function ListeningHistoryView({
  events,
  profile,
  engagementEvents,
  engagementProfile,
  rankerModel,
  enabled,
  persistent,
  onPersistenceChange,
  onResetLearning,
}: {
  events: readonly ListeningEvent[];
  profile: ListeningProfile;
  engagementEvents: readonly EngagementEvent[];
  engagementProfile: EngagementProfile;
  rankerModel: RankerModel;
  enabled: boolean;
  persistent: boolean;
  onPersistenceChange: (value: boolean) => void;
  onResetLearning: () => void;
}) {
  const recentEvents = [...events]
    .sort((left, right) => right.at - left.at)
    .slice(0, 60);
  const totalSeconds = events.reduce(
    (total, event) => total + Math.max(0, event.deltaSeconds),
    0,
  );
  const uniqueSongs = new Set(events.map((event) => event.songId)).size;
  const completion = Math.round(profile.averageCompletionRatio * 100);
  const interactions = engagementEvents.filter(
    (event) => event.kind !== "recommendation-impression",
  );
  const recentInteractions = [...interactions]
    .sort((left, right) => right.at - left.at)
    .slice(0, 12);
  const learnedSamples = rankerModel.samples;
  const learnedConfidence = Math.round(rankerConfidence(rankerModel) * 100);
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="listening-history-view">
      <div className="listening-history-intro">
        <p>
          {enabled
            ? "This is the local listening profile Volta uses to shape recommendations."
            : "Personalized recommendation tracking is turned off."}
        </p>
        <small>
          Playback history and interactions stay on this device. Normal
          Navidrome scrobbling is separate.
        </small>
      </div>
      <label className="listening-history-retention">
        <span>
          <b>Keep history across logins and restarts</b>
          <small>
            {persistent
              ? "Your profile will return when you sign in again."
              : "Keep it only for this browser session; logout clears it."}
          </small>
        </span>
        <input
          aria-label="Keep history across logins and restarts"
          type="checkbox"
          checked={persistent}
          onChange={(event) => onPersistenceChange(event.target.checked)}
        />
      </label>
      <div className="listening-history-stats" aria-label="Listening profile summary">
        <div>
          <strong>{events.length}</strong>
          <span>events retained</span>
        </div>
        <div>
          <strong>{profile.sessions}</strong>
          <span>listening sessions</span>
        </div>
        <div>
          <strong>{uniqueSongs}</strong>
          <span>songs heard</span>
        </div>
        <div>
          <strong>{duration(totalSeconds)}</strong>
          <span>audible time</span>
        </div>
        <div>
          <strong>{interactions.length}</strong>
          <span>actions tracked</span>
        </div>
        <div>
          <strong>{learnedSamples}</strong>
          <span>learning samples</span>
        </div>
      </div>
      <section className="listening-history-method">
        <h3>How recommendations use this</h3>
        <ul>
          <li>Longer listens and finished songs count as stronger interest.</li>
          <li>Early skips and "not interested" reduce that artist and genre.</li>
          <li>Favorites, queue adds, playlist adds, and album views add weight.</li>
          <li>Songs played together in one sitting teach item-to-item similarity.</li>
          <li>Time of day, weekday, and typical track length tune the context.</li>
          <li>A local model learns which signals predict what you actually play.</li>
        </ul>
        {profile.events > 0 && (
          <small>
            Average completion across recorded outcomes: {completion}%. Local
            model confidence: {learnedConfidence}%
            {engagementProfile.mutes.size
              ? ` · ${engagementProfile.mutes.size} muted artist${
                  engagementProfile.mutes.size === 1 ? "" : "s"
                }`
              : ""}
            .
          </small>
        )}
        <button
          className="secondary-button"
          type="button"
          disabled={!learnedSamples && !interactions.length}
          onClick={onResetLearning}
        >
          Reset what Volta has learned
        </button>
      </section>
      {recentInteractions.length > 0 && (
        <section className="listening-history-activity">
          <div className="listening-history-section-heading">
            <h3>Actions</h3>
            <span>Showing {recentInteractions.length}</span>
          </div>
          <div className="listening-history-list" aria-label="Recent interactions">
            {recentInteractions.map((event) => (
              <article className="listening-history-event" key={event.id}>
                <div className="listening-history-event-copy">
                  <b>{event.entity?.name || event.text || "Library"}</b>
                  <span>
                    {ENGAGEMENT_EVENT_LABELS[event.kind] || event.kind}
                    {event.entity?.artistName ? ` · ${event.entity.artistName}` : ""}
                  </span>
                </div>
                <div className="listening-history-event-meta">
                  <time dateTime={new Date(event.at).toISOString()}>
                    {dateFormatter.format(event.at)}
                  </time>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="listening-history-activity">
        <div className="listening-history-section-heading">
          <h3>Recent activity</h3>
          <span>{recentEvents.length ? `Showing ${recentEvents.length}` : "Nothing recorded yet"}</span>
        </div>
        {recentEvents.length ? (
          <div className="listening-history-list" aria-label="Recent listening activity">
            {recentEvents.map((event) => (
              <article className="listening-history-event" key={event.id}>
                <div className="listening-history-event-copy">
                  <b>{event.title}</b>
                  <span>
                    {event.artist || "Unknown artist"}
                    {event.album ? ` · ${event.album}` : ""}
                  </span>
                </div>
                <div className="listening-history-event-meta">
                  <span className={`listening-event-kind ${event.kind}`}>
                    {LISTENING_EVENT_LABELS[event.kind] || event.kind}
                  </span>
                  <time dateTime={new Date(event.at).toISOString()}>
                    {dateFormatter.format(event.at)}
                  </time>
                  {event.deltaSeconds > 0 && (
                    <small>{duration(event.deltaSeconds)} heard</small>
                  )}
                  {event.kind === "skip" && (
                    <small>at {duration(event.totalSeconds)}</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="listening-history-empty">
            Play a song for the profile to start learning your habits.
          </p>
        )}
      </section>
    </div>
  );
}

function Connect({
  onConnect,
  busy,
  error,
  localMusic,
  localMusicBusy,
  localMusicError,
  localMusicInputRef,
  onChooseLocalMusic,
  onImportLocalMusic,
  onOpenLocalMusic,
}: {
  onConnect: (credentials: Credentials, rememberMe: boolean) => void;
  busy: boolean;
  error: string;
  localMusic: LocalMusicLibrary | null;
  localMusicBusy: boolean;
  localMusicError: string;
  localMusicInputRef: RefObject<HTMLInputElement>;
  onChooseLocalMusic: () => void;
  onImportLocalMusic: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>;
  onOpenLocalMusic: () => void;
}) {
  const [draft] = useState(readLoginDraft);
  const [server, setServer] = useState(() =>
    draft.server ||
      safeRead(localStorage, "volta-server") ||
      readRememberedCredentials()?.server ||
      "",
  );
  const [username, setUsername] = useState(() =>
    draft.username ||
      safeRead(localStorage, "volta-username") ||
      readRememberedCredentials()?.username ||
      "",
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [source, setSource] = useState<"navidrome" | "local">("navidrome");
  const [rememberMe, setRememberMe] = useState(
    () => safeRead(localStorage, "volta-remember-me") === "true",
  );
  const saveDraft = (next: Partial<LoginDraft>) => {
    safeWrite(
      sessionStorage,
      LOGIN_DRAFT_KEY,
      JSON.stringify({ server, username, ...next }),
    );
  };
  useEffect(() => {
    safeWrite(
      sessionStorage,
      LOGIN_DRAFT_KEY,
      JSON.stringify({ server, username }),
    );
  }, [server, username]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConnect({ server, username, password }, rememberMe);
  };
  const tryDemo = () =>
    onConnect(
      {
        server: "https://demo.navidrome.org",
        username: "demo",
        password: "demo",
      },
      false,
    );
  return (
    <main className="connect-screen">
      <div className="connect-brand">
        <img className="brand-bolt" src="/volta-bolt.svg" alt="" />
        <span>Volta</span>
      </div>
      <form className="connect-form" onSubmit={submit}>
        <div className="connect-icon">
          <img src="/volta-bolt.svg" alt="Volta" />
        </div>
        <h1>Volta</h1>
        <p>
          {source === "local"
            ? "Play music from a folder on this device."
            : "Connect to Navidrome to start listening."}
        </p>
        <div
          className={`connect-source-switch${
            source === "local" ? " local-selected" : ""
          }`}
          aria-label="Music source"
        >
          <button
            className={source === "navidrome" ? "selected" : ""}
            type="button"
            aria-pressed={source === "navidrome"}
            onClick={() => setSource("navidrome")}
          >
            Navidrome
          </button>
          <button
            className={source === "local" ? "selected" : ""}
            type="button"
            aria-pressed={source === "local"}
            onClick={() => setSource("local")}
          >
            This device
          </button>
        </div>
        <input
          ref={localMusicInputRef}
          className="visually-hidden"
          type="file"
          multiple
          aria-label="Choose music folder"
          onChange={(event) => void onImportLocalMusic(event)}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        {source === "local" ? (
          <div className="connect-source-panel" key={source}>
            <div className="connect-local-source">
              <div className="connect-local-source-copy">
                <FolderOpen size={18} />
                <span>
                  <b>{localMusic?.directoryName || "No folder selected"}</b>
                  <small>
                    {localMusic
                      ? `${localMusic.tracks.length} supported tracks ready`
                      : "Choose your music folder to continue. (no music is uploaded)"}
                  </small>
                </span>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || localMusicBusy}
                onClick={() => void onChooseLocalMusic()}
              >
                <FolderOpen size={14} />
                {localMusicBusy
                  ? "Reading…"
                  : localMusic
                    ? "Change folder"
                    : "Choose folder"}
              </button>
            </div>
            {localMusicError && (
              <p className="connect-local-error" role="alert">
                {localMusicError}
              </p>
            )}
            <button
              className="primary-button connect-submit"
              type="button"
              disabled={busy || localMusicBusy || !localMusic?.tracks.length}
              onClick={onOpenLocalMusic}
            >
              Open local library
            </button>
            <button
              className="demo-button"
              type="button"
              disabled={busy || localMusicBusy}
              onClick={() => setSource("navidrome")}
            >
              Use Navidrome instead
            </button>
          </div>
        ) : (
          <div className="connect-source-panel" key={source}>
          <div className="connection-fields">
          <label>
            Server
            <input
              required
              autoComplete="url"
              placeholder="https://music.example.com"
              value={server}
              onChange={(event) => {
                const value = event.target.value;
                setServer(value);
                saveDraft({ server: value });
              }}
            />
          </label>
          <label>
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => {
                const value = event.target.value;
                setUsername(value);
                saveDraft({ username: value });
              }}
              placeholder="Username"
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                required
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  const value = event.target.value;
                  setPassword(value);
                }}
                placeholder="Password"
              />
              <button
                className="password-toggle"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          </div>
          <label className="remember-row">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
          />
          <span>Remember this sign-in on this device</span>
          </label>
          {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
          )}
          <button className="primary-button connect-submit" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
          </button>
          <button
          className="demo-button"
          type="button"
          disabled={busy}
          onClick={tryDemo}
        >
          <Play size={14} fill="currentColor" />
          Try the Navidrome demo
          </button>
          </div>
        )}
      </form>
    </main>
  );
}

export default function App() {
  const isBetaHost =
    window.location.hostname === "beta-player.ayois.gay" ||
    window.location.hostname === "beta-player.voltamusic.xyz";
  const alternateVersionUrl = (() => {
    const url = new URL(window.location.href);
    url.hostname = isBetaHost
      ? url.hostname.replace("beta-player.", "player.")
      : url.hostname.replace("player.", "beta-player.");
    return url.toString();
  })();
  const [client, setClient] = useState<Navidrome | null>(null);
  const [sourceMode, setSourceMode] = useState<"navidrome" | "local">(
    "navidrome",
  );
  const localClient = useMemo(
    () =>
      new Navidrome({
        server: "http://local.volta.invalid",
        username: "Local Library",
        password: "",
      }),
    [],
  );
  const [account, setAccount] = useState({ server: "", username: "" });
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionState, setConnectionState] = useState<
    "online" | "offline" | "reconnecting"
  >(() => (navigator.onLine ? "online" : "offline"));
  const [notice, setNotice] = useState("");
  const notify = useCallback((message: string) => setNotice(message), []);
  const activeClient = sourceMode === "local" ? localClient : client;
  const trackingKey = activeClient
    ? listeningHistoryKey(activeClient.server, activeClient.username)
    : "";
  const [listeningHistoryEnabled, setListeningHistoryEnabled] = useState(
    () => safeRead(localStorage, LISTENING_HISTORY_ENABLED_KEY) !== "false",
  );
  const [listeningHistoryPersistent, setListeningHistoryPersistent] = useState(
    () => safeRead(localStorage, LISTENING_HISTORY_PERSIST_KEY) !== "false",
  );
  const [listeningEvents, setListeningEvents] = useState<ListeningEvent[]>([]);
  const listeningStorage = listeningHistoryPersistent ? localStorage : sessionStorage;
  const engagementKey = activeClient
    ? engagementStorageKey(activeClient.server, activeClient.username)
    : "";
  const rankerModelKey = activeClient
    ? rankerModelStorageKey(activeClient.server, activeClient.username)
    : "";
  const impressionKey = activeClient
    ? impressionStorageKey(activeClient.server, activeClient.username)
    : "";
  const [engagementEvents, setEngagementEvents] = useState<EngagementEvent[]>([]);
  const [rankerModel, setRankerModel] = useState<RankerModel>(() =>
    emptyRankerModel(),
  );
  const impressionsRef = useRef<PendingImpression[]>([]);
  const rankerModelRef = useRef<RankerModel>(emptyRankerModel());
  const rewardedEventIds = useRef<Set<string>>(new Set());
  const recommendedAlbumIds = useRef<Set<string>>(new Set());
  const moveStored = useCallback((from: Storage, to: Storage, key: string) => {
    if (!key) return;
    const raw = safeRead(from, key);
    safeRemove(to, key);
    if (raw) safeWrite(to, key, raw);
    safeRemove(from, key);
  }, []);
  const changeListeningHistoryPersistence = useCallback(
    (persistent: boolean) => {
      if (persistent === listeningHistoryPersistent) return;
      if (trackingKey) {
        const from = listeningHistoryPersistent ? localStorage : sessionStorage;
        const to = persistent ? localStorage : sessionStorage;
        const existing = readListeningHistory(from, trackingKey);
        clearListeningHistory(to, trackingKey);
        if (existing.length) writeListeningHistory(to, trackingKey, existing);
        clearListeningHistory(from, trackingKey);
        moveStored(from, to, engagementKey);
        moveStored(from, to, rankerModelKey);
        moveStored(from, to, impressionKey);
      }
      setListeningHistoryPersistent(persistent);
    },
    [
      engagementKey,
      impressionKey,
      listeningHistoryPersistent,
      moveStored,
      rankerModelKey,
      trackingKey,
    ],
  );
  const recordPlaybackEvent = useCallback(
    (event: ListeningEvent, storageKey: string) => {
      if (!listeningHistoryEnabled || !storageKey) return;
      const next = appendListeningEvent(listeningStorage, storageKey, event);
      if (storageKey === trackingKey) setListeningEvents(next);
    },
    [listeningHistoryEnabled, listeningStorage, trackingKey],
  );
  const recordEngagement = useCallback(
    (input: EngagementEventInput) => {
      if (!listeningHistoryEnabled || !engagementKey) return;
      const event = createEngagementEvent(input);
      const next = appendEngagement(listeningStorage, engagementKey, event);
      setEngagementEvents(next);
    },
    [engagementKey, listeningHistoryEnabled, listeningStorage],
  );
  const learnFromOutcome = useCallback(
    (target: RewardTarget, reward: number, at?: number) => {
      if (!listeningHistoryEnabled || !impressionKey) return;
      const attributed = attributeReward(
        impressionsRef.current,
        target,
        reward,
        at ?? Date.now(),
      );
      if (!attributed.examples.length) return;
      impressionsRef.current = attributed.remaining;
      writeImpressions(listeningStorage, impressionKey, attributed.remaining);
      const trained = trainRanker(rankerModelRef.current, attributed.examples, 3);
      rankerModelRef.current = trained;
      writeRankerModel(listeningStorage, rankerModelKey, trained);
      setRankerModel(trained);
    },
    [impressionKey, listeningHistoryEnabled, listeningStorage, rankerModelKey],
  );
  const resetLearning = useCallback(() => {
    clearRankerState(listeningStorage, rankerModelKey, impressionKey);
    clearEngagement(listeningStorage, engagementKey);
    impressionsRef.current = [];
    const fresh = emptyRankerModel();
    rankerModelRef.current = fresh;
    setRankerModel(fresh);
    setEngagementEvents([]);
    notify("Volta's learned profile has been reset.");
  }, [
    engagementKey,
    impressionKey,
    listeningStorage,
    notify,
    rankerModelKey,
  ]);
  useEffect(() => {
    safeWrite(
      localStorage,
      LISTENING_HISTORY_ENABLED_KEY,
      String(listeningHistoryEnabled),
    );
    safeWrite(
      localStorage,
      LISTENING_HISTORY_PERSIST_KEY,
      String(listeningHistoryPersistent),
    );
    setListeningEvents(
      listeningHistoryEnabled
        ? readListeningHistory(listeningStorage, trackingKey)
        : [],
    );
    setEngagementEvents(
      listeningHistoryEnabled ? readEngagement(listeningStorage, engagementKey) : [],
    );
    const model = listeningHistoryEnabled
      ? readRankerModel(listeningStorage, rankerModelKey)
      : emptyRankerModel();
    rankerModelRef.current = model;
    setRankerModel(model);
    impressionsRef.current = listeningHistoryEnabled
      ? readImpressions(listeningStorage, impressionKey)
      : [];
    rewardedEventIds.current.clear();
  }, [
    engagementKey,
    impressionKey,
    listeningHistoryEnabled,
    listeningHistoryPersistent,
    listeningStorage,
    rankerModelKey,
    trackingKey,
  ]);
  const listeningProfile = useMemo(
    () => summarizeListening(listeningEvents),
    [listeningEvents],
  );
  const engagementProfile = useMemo(
    () => summarizeEngagement(engagementEvents),
    [engagementEvents],
  );
  // Playback itself is the strongest implicit feedback. Fold new events into
  // the local ranker so the shelf learns from what actually got listened to.
  useEffect(() => {
    if (!listeningHistoryEnabled || !impressionKey || !listeningEvents.length)
      return;
    const seen = rewardedEventIds.current;
    const pending = listeningEvents.filter((event) => !seen.has(event.id));
    if (!pending.length) return;
    const cutoff = Date.now() - REWARD_WINDOW_MS;
    pending.forEach((event) => {
      seen.add(event.id);
      // Anything older than the attribution window can no longer match a
      // recommendation we showed, so skip it rather than replaying old days.
      if (event.at < cutoff) return;
      const reward = playbackReward(event);
      if (!reward) return;
      learnFromOutcome(
        {
          albumId: event.albumId,
          artistId: event.artistId,
          genres: (event.genre || "")
            .split(/[,;|/]+/)
            .map((genre) => genre.trim())
            .filter(Boolean),
        },
        reward,
        event.at,
      );
    });
    if (seen.size > 3000) {
      const recent = new Set(listeningEvents.slice(-1500).map((event) => event.id));
      rewardedEventIds.current = recent;
    }
  }, [impressionKey, learnFromOutcome, listeningEvents, listeningHistoryEnabled]);
  const player = usePlayer(activeClient, notify, recordPlaybackEvent);
  const [history, setHistory] = useState<Route[]>([{ page: "home" }]);
  const route = history[history.length - 1];
  const [data, setData] = useState<PageData>(EMPTY);
  const [sidebarPlaylists, setSidebarPlaylists] = useState<Playlist[]>([]);
  const [pending, setPending] = useState(false);
  const [pageError, setPageError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState(readSearchHistory);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("alphabeticalByName");
  const [reload, setReload] = useState(0);
  const activeLoadKey = useRef("");
  const pageMemory = useRef(new Map<string, PageData>());
  const requestRefresh = useCallback(() => {
    cancelArtworkPrefetches();
    if (activeLoadKey.current) pageMemory.current.delete(activeLoadKey.current);
    setReload((value) => value + 1);
  }, []);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [renderLimit, setRenderLimit] = useState(60);
  const [favorites, setFavorites] = useState<Record<string, boolean>>(
    readLocalFavorites,
  );
  const [favoritePending, setFavoritePending] = useState<Set<string>>(
    new Set(),
  );
  const [panel, setPanel] = useState<"queue" | "lyrics" | null>(null);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(
    null,
  );
  const [detailsSong, setDetailsSong] = useState<Song | null>(null);
  const [detailsAlbum, setDetailsAlbum] = useState<AlbumRecord | null>(null);
  const [fullPlayer, setFullPlayer] = useState(false);
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft | null>(
    null,
  );
  const [playlistPickerSong, setPlaylistPickerSong] = useState<Song | null>(
    null,
  );
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(
    null,
  );
  const [playlistMutationBusy, setPlaylistMutationBusy] = useState(false);
  const [listeningHistoryOpen, setListeningHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [recordingShortcut, setRecordingShortcut] =
    useState<ShortcutId | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(() =>
    readShortcutBindings(localStorage),
  );
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [theme, setTheme] = useState(
    () => safeRead(localStorage, "volta-theme") || "dark",
  );
  const [interfaceScale, setInterfaceScale] = useState(readInterfaceScale);
  // Interface scaling zooms #root, so a slider inside that zoomed tree would
  // resize and shift under the pointer while being dragged. Instead the user
  // opens a preview: the draft scale is applied live, but the controls are
  // portaled outside #root so they never change size, and the value is only
  // persisted when the user confirms.
  const [scalePreview, setScalePreview] = useState<number | null>(null);
  const appliedInterfaceScale = scalePreview ?? interfaceScale;
  const setPreviewInterfaceScale = useCallback((value: number) => {
    setScalePreview(clampInterfaceScale(value));
  }, []);
  const adjustInterfaceScale = useCallback(
    (delta: number) => {
      setScalePreview((current) =>
        clampInterfaceScale((current ?? interfaceScale) + delta),
      );
    },
    [interfaceScale],
  );
  const [floatingSidebar, setFloatingSidebar] = useState(
    () => safeRead(localStorage, "volta-floating-sidebar") !== "false",
  );
  const [remembered] = useState(readRememberedCredentials);
  const [sessionCredentials] = useState(readSessionCredentials);
  const [authReady, setAuthReady] = useState(false);
  const [animatedArtwork, setAnimatedArtwork] = useState(
    () =>
      safeRead(localStorage, "volta-animated-artwork-mode") !== "off" &&
      safeRead(localStorage, "volta-animated-artwork") !== "false",
  );
  const [animateArtworkEverywhere, setAnimateArtworkEverywhere] = useState(
    () => safeRead(localStorage, "volta-animated-artwork-mode") === "everywhere",
  );
  const [experimentalArtworkLoading, setExperimentalArtworkLoading] = useState(
    () => safeRead(localStorage, "volta-experimental-artwork-loading") === "true",
  );
  const [refreshCollectionOnVisit, setRefreshCollectionOnVisit] = useState(
    () => safeRead(localStorage, "volta-refresh-collection-on-visit") === "true",
  );
  const [warnBeforeLeave, setWarnBeforeLeave] = useState(
    () => safeRead(localStorage, "volta-warn-before-leave") !== "false",
  );
  const [externalLyricsEnabled, setExternalLyricsEnabled] = useState(
    () => safeRead(localStorage, EXTERNAL_LYRICS_KEY) === "true",
  );
  const [infinitePlayCount, setInfinitePlayCount] = useState(() => {
    const value = Number(safeRead(localStorage, INFINITE_PLAY_COUNT_KEY));
    return Number.isFinite(value) ? Math.min(200, Math.max(1, Math.trunc(value))) : 50;
  });
  const [infinitePlayMode, setInfinitePlayMode] = useState<InfinitePlayMode>(
    () => (safeRead(localStorage, INFINITE_PLAY_MODE_KEY) === "random" ? "random" : "algorithm"),
  );
  const [infinitePlayEnabled, setInfinitePlayEnabled] = useState(
    () => safeRead(localStorage, INFINITE_PLAY_ENABLED_KEY) === "true",
  );
  const [infinitePlayBusy, setInfinitePlayBusy] = useState(false);
  const [localMusic, setLocalMusic] = useState<LocalMusicLibrary | null>(null);
  const [localMusicBusy, setLocalMusicBusy] = useState(false);
  const [localMusicError, setLocalMusicError] = useState("");
  const localMusicInputRef = useRef<HTMLInputElement>(null);
  const localMusicGeneration = useRef(0);
  const [privatePathNumber, setPrivatePathNumber] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const loadGeneration = useRef(0);
  const lastLoadKey = useRef("");
  const autoConnectStarted = useRef(false);
  const restoredSongAccount = useRef("");
  const restoredLocalLibrary = useRef("");
  const restoredLocalDirectory = useRef(false);
  const autoOpenedLocalLibrary = useRef(false);
  const infinitePlayAttempt = useRef("");
  const infinitePlaySongIds = useRef(new Set<string>());
  const playbackSnapshot = useRef<{
    queue: Song[];
    currentIndex: number;
    position: number;
    shuffle: boolean;
    repeat: PlaybackSession["repeat"];
    original: boolean;
    wasPlaying: boolean;
  }>({
    queue: [],
    currentIndex: -1,
    position: 0,
    shuffle: false,
    repeat: "off",
    original: true,
    wasPlaying: false,
  });
  playbackSnapshot.current = {
    queue: player.queue,
    currentIndex: player.currentIndex,
    position: Math.max(0, Math.floor(player.currentTime)),
    shuffle: player.shuffle,
    repeat: player.repeat,
    original: player.original,
    wasPlaying: player.playing,
  };

  useEffect(() => {
    const generation = ++localMusicGeneration.current;
    void restoreLocalMusicDirectory()
      .then((library) => {
        if (generation === localMusicGeneration.current && library) {
          restoredLocalDirectory.current = true;
          setLocalMusic(library);
        }
      })
      .catch(() => {
        /* A saved folder is optional and may need permission again. */
      });
  }, []);

  const retryConnection = useCallback(async () => {
    if (!client || sourceMode === "local") return;
    setConnectionState("reconnecting");
    try {
      await client.ping();
      setConnectionState("online");
      setPageError("");
      requestRefresh();
    } catch {
      setConnectionState(navigator.onLine ? "reconnecting" : "offline");
    }
  }, [client, requestRefresh, sourceMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    safeWrite(localStorage, "volta-theme", theme);
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--volta-interface-scale",
      String(appliedInterfaceScale / 100),
    );
    // A preview is temporary: only a committed value is written to storage.
    if (scalePreview === null)
      safeWrite(localStorage, INTERFACE_SCALE_KEY, String(interfaceScale));
  }, [appliedInterfaceScale, interfaceScale, scalePreview]);
  useEffect(() => {
    safeWrite(localStorage, "volta-animated-artwork", String(animatedArtwork));
    safeWrite(
      localStorage,
      "volta-animated-artwork-mode",
      !animatedArtwork ? "off" : animateArtworkEverywhere ? "everywhere" : "prominent",
    );
  }, [animatedArtwork, animateArtworkEverywhere]);
  useEffect(() => {
    safeWrite(
      localStorage,
      "volta-experimental-artwork-loading",
      String(experimentalArtworkLoading),
    );
  }, [experimentalArtworkLoading]);
  useEffect(() => {
    safeWrite(
      localStorage,
      "volta-refresh-collection-on-visit",
      String(refreshCollectionOnVisit),
    );
  }, [refreshCollectionOnVisit]);
  useEffect(() => {
    safeWrite(
      localStorage,
      "volta-warn-before-leave",
      String(warnBeforeLeave),
    );
  }, [warnBeforeLeave]);
  useEffect(() => {
    safeWrite(
      localStorage,
      EXTERNAL_LYRICS_KEY,
      String(externalLyricsEnabled),
    );
  }, [externalLyricsEnabled]);
  useEffect(() => {
    safeWrite(localStorage, INFINITE_PLAY_COUNT_KEY, String(infinitePlayCount));
    safeWrite(localStorage, INFINITE_PLAY_MODE_KEY, infinitePlayMode);
    safeWrite(localStorage, INFINITE_PLAY_ENABLED_KEY, String(infinitePlayEnabled));
  }, [infinitePlayCount, infinitePlayEnabled, infinitePlayMode]);
  useEffect(() => {
    safeWrite(localStorage, SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);
  useEffect(() => {
    safeWrite(localStorage, SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);
  useEffect(() => {
    const goOffline = () => {
      if (sourceMode !== "local") setConnectionState("offline");
    };
    const goOnline = () => {
      if (sourceMode === "local") setConnectionState("online");
      else if (client) void retryConnection();
      else setConnectionState("online");
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (!navigator.onLine && sourceMode !== "local")
      setConnectionState("offline");
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [client, retryConnection, sourceMode]);
  useEffect(() => {
    if (!warnBeforeLeave || !player.playing) return;
    const confirmLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [player.playing, warnBeforeLeave]);
  useEffect(() => {
    if (!client) return;
    const next =
      fullPlayer && player.currentSong
        ? fullscreenPath(privatePathNumber)
        : pathForRoute(privatePathNumber, route, query);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next)
      window.history.replaceState({ voltaRoute: true }, "", next);
  }, [
    client,
    fullPlayer,
    player.currentSong?.id,
    privatePathNumber,
    route,
    query,
    sourceMode,
  ]);
  useEffect(() => {
    document.title = player.currentSong?.title
      ? `${player.currentSong.title} | Volta`
      : "Volta";
  }, [player.currentSong?.title]);
  useEffect(() => {
    if (
      !client ||
      sourceMode === "local" ||
      !account.server ||
      !account.username
    )
      return;
    const accountKey = `${account.server}:${account.username}`;
    if (restoredSongAccount.current === accountKey) return;
    restoredSongAccount.current = accountKey;
    const session = readPlaybackSession(account.server, account.username);
    if (session) player.restoreSession(session);
  }, [account.server, account.username, client, player.restoreSession, sourceMode]);
  useEffect(() => {
    if (sourceMode !== "local" || !localMusic?.tracks.length) return;
    const libraryKey = localMusic.directoryName;
    if (restoredLocalLibrary.current === libraryKey) return;
    restoredLocalLibrary.current = libraryKey;
    player.setVolume(readLocalVolume(libraryKey) ?? 0.8);
    const session = readLocalPlaybackSession(localMusic);
    if (session) player.restoreSession(session);
  }, [localMusic, player.restoreSession, player.setVolume, sourceMode]);
  useEffect(() => {
    if (
      !client ||
      sourceMode === "local" ||
      !account.server ||
      !account.username ||
      !player.queue.length ||
      player.queue.some(isLocalSong)
    )
      return;
    safeWrite(
      localStorage,
      lastPlayedSongKey(account.server, account.username),
      JSON.stringify(playbackSnapshot.current),
    );
  }, [
    account.server,
    account.username,
    client,
    player.queue,
    player.currentIndex,
    Math.floor(player.currentTime),
    player.shuffle,
    player.repeat,
    player.original,
    player.playing,
    sourceMode,
  ]);
  useEffect(() => {
    if (
      sourceMode !== "local" ||
      !localMusic?.directoryName ||
      !player.queue.length ||
      player.queue.some((song) => !isLocalSong(song))
    )
      return;
    safeWrite(
      localStorage,
      localPlaybackKey(localMusic.directoryName),
      JSON.stringify(serializableLocalPlayback(playbackSnapshot.current)),
    );
  }, [
    localMusic?.directoryName,
    player.currentIndex,
    player.currentTime,
    player.original,
    player.playing,
    player.queue,
    player.repeat,
    player.shuffle,
    sourceMode,
  ]);
  useEffect(() => {
    if (sourceMode !== "local" || !localMusic?.directoryName) return;
    safeWrite(
      localStorage,
      localVolumeKey(localMusic.directoryName),
      String(player.volume),
    );
  }, [localMusic?.directoryName, player.volume, sourceMode]);
  useEffect(() => {
    if (sourceMode !== "local" || !localMusic?.directoryName) return;
    const saveLocalPlayback = () => {
      if (!playbackSnapshot.current.queue.length) return;
      safeWrite(
        localStorage,
        localPlaybackKey(localMusic.directoryName),
        JSON.stringify(serializableLocalPlayback(playbackSnapshot.current)),
      );
    };
    window.addEventListener("pagehide", saveLocalPlayback);
    return () => window.removeEventListener("pagehide", saveLocalPlayback);
  }, [localMusic?.directoryName, sourceMode]);
  useEffect(() => {
    if (
      !client ||
      sourceMode === "local" ||
      !account.server ||
      !account.username
    )
      return;
    safeWrite(
      localStorage,
      volumeKey(account.server, account.username),
      String(player.volume),
    );
  }, [account.server, account.username, client, player.volume, sourceMode]);
  useEffect(() => {
    if (
      !client ||
      sourceMode === "local" ||
      !account.server ||
      !account.username
    )
      return;
    const savePlayback = () => {
      if (
        !playbackSnapshot.current.queue.length ||
        playbackSnapshot.current.queue.some(isLocalSong)
      )
        return;
      safeWrite(
        localStorage,
        lastPlayedSongKey(account.server, account.username),
        JSON.stringify(playbackSnapshot.current),
      );
    };
    window.addEventListener("pagehide", savePlayback);
    return () => window.removeEventListener("pagehide", savePlayback);
  }, [account.server, account.username, client, sourceMode]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 120);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    try {
      sessionStorage.removeItem("volta-password");
    } catch {
      /* Remove legacy password persistence when possible. */
    }
  }, []);

  const navigate = useCallback(
    (next: Route, nextQuery?: string) => {
      setPending(true);
      setHistory((previous) => [...previous, next]);
      if (next.id && next.page !== "search") {
        if (next.page === "album") {
          const entity: EngagementEntity = {
            type: "album",
            id: next.id,
            name: next.title,
          };
          recordEngagement({ kind: "album-view", entity });
          const recommended = recommendedAlbumIds.current.has(next.id);
          if (recommended) {
            recordEngagement({ kind: "recommendation-click", entity });
            learnFromOutcome({ albumId: next.id }, 0.8);
          } else {
            learnFromOutcome({ albumId: next.id }, 0.3);
          }
        } else if (next.page === "artist") {
          recordEngagement({
            kind: "artist-view",
            entity: { type: "artist", id: next.id, name: next.title },
          });
        } else if (next.page === "genre") {
          recordEngagement({
            kind: "genre-view",
            entity: { type: "genre", id: next.id, name: next.title || next.id },
          });
        }
      }
      if (client && privatePathNumber) {
        window.history.pushState(
          { voltaRoute: true },
          "",
          pathForRoute(
            privatePathNumber,
            next,
            next.page === "search" ? nextQuery ?? query : "",
          ),
        );
      }
      if (next.page === "search" && nextQuery !== undefined)
        setQuery(nextQuery);
      setFilter("");
      setMobileSidebar(false);
      pageRef.current?.scrollTo({ top: 0 });
    },
    [
      client,
      learnFromOutcome,
      privatePathNumber,
      query,
      recordEngagement,
      sourceMode,
    ],
  );
  const beginInterfaceScalePreview = useCallback(() => {
    setScalePreview(interfaceScale);
    // Land on Home so the preview starts from a normal view the user can browse.
    navigate({ page: "home" });
  }, [interfaceScale, navigate]);
  const confirmInterfaceScalePreview = useCallback(() => {
    if (scalePreview !== null) setInterfaceScale(scalePreview);
    setScalePreview(null);
    // Close the loop: the user started this from Settings.
    navigate({ page: "settings" });
  }, [navigate, scalePreview]);
  const cancelInterfaceScalePreview = useCallback(() => {
    setScalePreview(null);
    navigate({ page: "settings" });
  }, [navigate]);
  const applyLocalMusic = useCallback(
    (library: LocalMusicLibrary) => {
      localMusicGeneration.current++;
      restoredLocalLibrary.current = "";
      player.stop();
      setLocalMusic((previous) => {
        releaseLocalMusicLibrary(previous);
        return library;
      });
      setLocalMusicError("");
      notify(
        library.tracks.length
          ? `Loaded ${library.tracks.length} tracks from ${library.directoryName}.`
          : `No supported audio files found in ${library.directoryName}.`,
      );
    },
    [notify, player.stop],
  );
  const chooseMusicFolder = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      localMusicInputRef.current?.click();
      return;
    }
    setLocalMusicBusy(true);
    setLocalMusicError("");
    try {
      const library = await chooseLocalDirectory();
      if (library) applyLocalMusic(library);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setLocalMusicError(
          error instanceof Error
            ? error.message
            : "The music folder could not be opened.",
        );
    } finally {
      setLocalMusicBusy(false);
    }
  }, [applyLocalMusic]);
  const importMusicFolder = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files || []);
      if (!files.length) return;
      event.currentTarget.value = "";
      setLocalMusicBusy(true);
      setLocalMusicError("");
      try {
        const library = await localLibraryFromFileList(files);
        try {
          await clearLocalDirectoryHandle();
        } catch {
          // A fallback folder selection should work even without IndexedDB.
        }
        applyLocalMusic(library);
      } catch (error) {
        setLocalMusicError(
          error instanceof Error
            ? error.message
            : "The music folder could not be opened.",
        );
      } finally {
        setLocalMusicBusy(false);
      }
    },
    [applyLocalMusic],
  );
  const openLocalLibrary = useCallback(() => {
    if (!localMusic?.tracks.length) return;
    const number =
      safeRead(localStorage, localLibraryPathKey("number")) ||
      randomLibraryPath();
    safeWrite(localStorage, localLibraryPathKey("number"), number);
    const browserRoute = readBrowserRoute(number);
    player.stop();
    restoredLocalLibrary.current = "";
    player.setVolume(readLocalVolume(localMusic.directoryName) ?? 0.8);
    safeWrite(localStorage, LOCAL_SOURCE_MODE_KEY, "local");
    setSourceMode("local");
    setClient(localClient);
    setAccount({ server: "This device", username: "Local Library" });
    setConnectionState("online");
    setConnectionError("");
    setPageError("");
    setData(EMPTY);
    setSidebarPlaylists([]);
    setFavorites(readLocalFavorites());
    setPanel(null);
    setFullPlayer(false);
    setQuery("");
    setFilter("");
    pageMemory.current.clear();
    lastLoadKey.current = "";
    setPrivatePathNumber(number);
    setQuery(browserRoute.query);
    setHistory([browserRoute.route]);
    window.history.replaceState(
      { voltaRoute: true },
      "",
      pathForRoute(number, browserRoute.route, browserRoute.query),
    );
  }, [localClient, localMusic, player.setVolume, player.stop]);
  useEffect(() => {
    if (
      autoOpenedLocalLibrary.current ||
      client ||
      remembered ||
      sessionCredentials ||
      sourceMode === "local" ||
      !restoredLocalDirectory.current ||
      safeRead(localStorage, LOCAL_SOURCE_MODE_KEY) !== "local" ||
      !localMusic?.tracks.length
    )
      return;
    autoOpenedLocalLibrary.current = true;
    openLocalLibrary();
  }, [
    client,
    localMusic,
    openLocalLibrary,
    remembered,
    sessionCredentials,
    sourceMode,
  ]);
  const closeContextMenu = useCallback(() => setContextTarget(null), []);
  const openSongContextMenu = useCallback(
    (event: ReactMouseEvent, song: Song) => {
      event.preventDefault();
      setContextTarget({
        type: "song",
        item: song,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );
  const openAlbumContextMenu = useCallback(
    (event: ReactMouseEvent, album: AlbumRecord) => {
      event.preventDefault();
      setContextTarget({
        type: "album",
        item: album,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );
  const back = () => {
    if (
      sourceMode === "local" &&
      privatePathNumber &&
      history.length > 1
    ) {
      setPending(true);
      window.history.back();
      return;
    }
    if (sourceMode === "local" && history.length > 1) {
      setPending(true);
      setHistory((previous) => previous.slice(0, -1));
      setFilter("");
      pageRef.current?.scrollTo({ top: 0 });
      return;
    }
    if (history.length > 1) {
      setPending(true);
      window.history.back();
      return;
    }
    if (route.page !== "home" && privatePathNumber) {
      const home = { page: "home" as Page };
      setPending(true);
      setHistory([home]);
      setFilter("");
      window.history.replaceState(
        { voltaRoute: true },
        "",
        pathForRoute(privatePathNumber, home),
      );
    }
  };
  useEffect(() => {
    if (!client) return;
    const onPopState = () => {
      if (
        window.location.pathname ===
        fullscreenPath(privatePathNumber)
      ) {
        setFullPlayer(Boolean(player.currentSong));
        return;
      }
      setFullPlayer(false);
      const next = readBrowserRoute(privatePathNumber);
      setPending(true);
      setQuery(next.query);
      setFilter("");
      setHistory((previous) => {
        const current = previous[previous.length - 1];
        if (
          current.page === next.route.page &&
          current.id === next.route.id
        ) {
          setPending(false);
          return previous;
        }
        const previousRoute = previous[previous.length - 2];
        if (
          previous.length > 1 &&
          previousRoute.page === next.route.page &&
          previousRoute.id === next.route.id
        )
          return previous.slice(0, -1);
        return [next.route];
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [client, player.currentSong, privatePathNumber, sourceMode]);
  const connect = async (
    credentials: Credentials,
    rememberMe = false,
    optimistic = false,
  ) => {
    setConnecting(true);
    setConnectionError("");
    try {
      const candidates = serverCandidates(credentials.server);
      let service: Navidrome | null = null;
      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          const next = new Navidrome({ ...credentials, server: candidate });
          if (!optimistic) await next.ping();
          service = next;
          break;
        } catch (error) {
          lastError = error;
          if (candidate !== candidates[0] || !isConnectionFailure(error))
            throw error;
        }
      }
      if (!service) throw lastError || new Error("Connection failed.");
      setSourceMode("navidrome");
      safeRemove(localStorage, LOCAL_SOURCE_MODE_KEY);
      safeWrite(localStorage, "volta-server", service.server);
      safeWrite(localStorage, "volta-username", service.username);
      safeWrite(localStorage, "volta-remember-me", String(rememberMe));
      safeRemove(sessionStorage, LOGIN_DRAFT_KEY);
      if (rememberMe) {
        safeWrite(
          localStorage,
          REMEMBERED_CREDENTIALS_KEY,
          JSON.stringify({
            server: service.server,
            username: service.username,
            auth: service.auth,
          }),
        );
      } else {
        safeRemove(localStorage, REMEMBERED_CREDENTIALS_KEY);
      }
      safeWrite(
        sessionStorage,
        SESSION_CREDENTIALS_KEY,
        JSON.stringify({
          server: service.server,
          username: service.username,
          auth: service.auth,
        }),
      );
      const identity = {
        server: service.server,
        username: service.username,
      };
      setConnectionState("online");
      player.setVolume(readVolume(identity.server, identity.username) ?? 0.8);
      const number =
        safeRead(
          localStorage,
          libraryPathKey(identity.server, identity.username, "number"),
        ) || randomLibraryPath();
      safeWrite(
        localStorage,
        libraryPathKey(identity.server, identity.username, "number"),
        number,
      );
      setPrivatePathNumber(number);
      const browserRoute = readBrowserRoute(number);
      setBrowserPath(number);
      setQuery(browserRoute.query);
      setFullPlayer(false);
      setAccount({
        server: service.server,
        username: service.username,
      });
      setClient(service);
      setHistory([browserRoute.route]);
      service
        .playlists()
        .then(setSidebarPlaylists)
        .catch(() =>
          notify("Playlists could not be loaded. Open Playlists to retry."),
        );
    } catch (error) {
      setConnectionError(
        error instanceof TypeError
          ? "Cannot reach Navidrome. Check the server address, HTTP/HTTPS, and whether your server allows this player’s origin (CORS)."
          : error instanceof Error
            ? error.message
            : "Connection failed. Check your server address and credentials.",
      );
    } finally {
      setConnecting(false);
    }
  };
  useEffect(() => {
    const storedCredentials = remembered || sessionCredentials;
    if (client || !storedCredentials) {
      setAuthReady(true);
      return;
    }
    if (autoConnectStarted.current) return;
    autoConnectStarted.current = true;
    void connect(
      {
        server: storedCredentials.server,
        username: storedCredentials.username,
        password: "",
        auth: storedCredentials.auth,
      },
      Boolean(remembered),
      true,
    ).finally(() => setAuthReady(true));
  }, [client, remembered, sessionCredentials]);
  const disconnect = () => {
    player.stop();
    if (!listeningHistoryPersistent && trackingKey)
      clearListeningHistory(sessionStorage, trackingKey);
    if (!listeningHistoryPersistent) {
      if (engagementKey) clearEngagement(sessionStorage, engagementKey);
      if (rankerModelKey || impressionKey)
        clearRankerState(sessionStorage, rankerModelKey, impressionKey);
      impressionsRef.current = [];
    }
    setSourceMode("navidrome");
    setClient(null);
    setData(EMPTY);
    setSidebarPlaylists([]);
    setFavorites({});
    setPanel(null);
    setFullPlayer(false);
    setQuery("");
    setAccount({ server: "", username: "" });
    setPrivatePathNumber("");
    safeRemove(localStorage, REMEMBERED_CREDENTIALS_KEY);
    safeRemove(localStorage, LOCAL_SOURCE_MODE_KEY);
    safeRemove(sessionStorage, SESSION_CREDENTIALS_KEY);
    safeRemove(sessionStorage, LOGIN_DRAFT_KEY);
    safeWrite(localStorage, "volta-remember-me", "false");
    setBrowserPath("");
  };
  const openFullPlayer = () => {
    if (!player.currentSong) return;
    setFullPlayer(true);
    window.history.pushState(
      { voltaFullscreen: true },
      "",
      fullscreenPath(privatePathNumber),
    );
  };
  const closeFullPlayer = () => {
    if (
      window.history.state?.voltaFullscreen &&
      window.location.pathname ===
        fullscreenPath(privatePathNumber)
    ) {
      window.history.back();
      return;
    }
    setFullPlayer(false);
    if (
      window.location.pathname ===
      fullscreenPath(privatePathNumber)
    ) {
      window.history.replaceState(
        { voltaRoute: true },
        "",
        pathForRoute(privatePathNumber, route, query),
      );
    }
  };

  useEffect(() => {
    if (!client) return;
    const generation = ++loadGeneration.current;
    let cancelled = false;
    const controller = new AbortController();
    const keepVisibleSearchResults =
      route.page === "search" && Boolean(debouncedQuery);
    const loadKey = [
      route.page,
      route.id || "",
      debouncedQuery,
      sort,
    ].join("\u001f");
    const isLocalSource = sourceMode === "local";
    activeLoadKey.current = loadKey;
    const sameViewRefresh = lastLoadKey.current === loadKey;
    lastLoadKey.current = loadKey;
    const memoryData = pageMemory.current.get(loadKey);
    const rotateHomeCollection =
      route.page === "home" && refreshCollectionOnVisit && !sameViewRefresh;
    if (memoryData && !sameViewRefresh && !rotateHomeCollection) {
      pageMemory.current.delete(loadKey);
      pageMemory.current.set(loadKey, memoryData);
      setData(memoryData);
      setPending(false);
      setPageError("");
      setRenderLimit(60);
      setHasMore(pageHasMore(route.page, memoryData));
      return () => controller.abort();
    }
    const cachedData = isLocalSource || sameViewRefresh
      ? null
      : readCachedPageData(client.server, client.username, loadKey);
    if (!keepVisibleSearchResults) setPending(true);
    setPageError("");
    if (cachedData) setData(cachedData);
    if (!keepVisibleSearchResults && !sameViewRefresh && !cachedData) {
      setHasMore(false);
      setRenderLimit(60);
      setData(EMPTY);
    }
    const load = async (): Promise<PageData> => {
      if (sourceMode === "local")
        return localPageData(localMusic, route, debouncedQuery, sort);
      switch (route.page) {
        case "home": {
          const [albums, recent, recentlyPlayed, frequent, favoriteResults] = await Promise.all([
            client.albums("random", 32, 0, controller.signal),
            client.albums("newest", 12, 0, controller.signal),
            client.albums("recent", 12, 0, controller.signal),
            client.albums("frequent", 12, 0, controller.signal),
            client.favorites(controller.signal).catch(() => ({
              song: [],
              album: [],
              artist: [],
            })),
          ]);
          const favoriteSongAlbumIds = favoriteAlbumIdsFromSongs(favoriteResults.song);
          const favoriteAlbumIds = [
            ...new Set([
              ...favoriteResults.album.map((album) => album.id),
              ...favoriteSongAlbumIds,
            ]),
          ];
          return {
            ...EMPTY,
            albums: albums.slice(0, 8),
            recent,
            recentlyPlayed,
            frequent,
            recommendationCandidates: mergeRecommendationCandidates(
              albums,
              recent,
              recentlyPlayed,
              frequent,
              favoriteResults.album,
            ),
            favoriteAlbumIds,
          };
        }
        case "recent":
        case "albums": {
          const albums = await client.albums(
            route.page === "recent" ? "newest" : sort,
            60,
            0,
            controller.signal,
          );
          return { ...EMPTY, albums };
        }
        case "played":
          return {
            ...EMPTY,
            albums: await client.albums("recent", 60, 0, controller.signal),
          };
        case "artists":
          return { ...EMPTY, artists: await client.artists(controller.signal) };
        case "songs":
          return {
            ...EMPTY,
            songs: await client.songs(0, 100, controller.signal),
          };
        case "favorites": {
          const results = await client.favorites(controller.signal);
          return { ...EMPTY, songs: results.song, albums: results.album };
        }
        case "playlists":
          return {
            ...EMPTY,
            playlists: await client.playlists(controller.signal),
          };
        case "album": {
          const [album, libraryAlbums] = await Promise.all([
            client.album(route.id!, controller.signal),
            client.albums("alphabeticalByName", 500, 0, controller.signal),
          ]);
          return {
            ...EMPTY,
            album,
            songs: album.song || [],
            similarAlbums: similarAlbumsFor(album, libraryAlbums),
          };
        }
        case "artist": {
          const [artist, libraryAlbums] = await Promise.all([
            client.artist(route.id!, controller.signal),
            client.albums("alphabeticalByName", 500, 0, controller.signal),
          ]);
          return {
            ...EMPTY,
            artist,
            albums: artist.album || [],
            similarArtists: similarArtistsFor(artist, libraryAlbums),
          };
        }
        case "playlist": {
          const playlist = await client.playlist(route.id!, controller.signal);
          return { ...EMPTY, playlist, songs: playlist.entry || [] };
        }
        case "search": {
          if (!debouncedQuery) return EMPTY;
          const results = await client.search(
            debouncedQuery,
            {},
            controller.signal,
          );
          return {
            ...EMPTY,
            albums: results.album,
            songs: results.song,
            artists: results.artist,
          };
        }
        case "genre":
          return EMPTY;
        case "settings":
          return EMPTY;
      }
    };
    load()
      .then(async (result) => {
        if (experimentalArtworkLoading)
          void preparePageArtwork(client, result, route.page);
        if (cancelled) return;
        setConnectionState(
          sourceMode === "local" || navigator.onLine ? "online" : "offline",
        );
        pageMemory.current.delete(loadKey);
        pageMemory.current.set(loadKey, result);
        // Keep Home pinned plus two most-recent non-Home pages.
        while (pageMemory.current.size > 3) {
          const evictable = [...pageMemory.current.keys()].find(
            (key) => !key.startsWith("home\u001f"),
          );
          pageMemory.current.delete(
            evictable || pageMemory.current.keys().next().value!,
          );
        }
        if (!isLocalSource)
          writeCachedPageData(client.server, client.username, loadKey, result);
        setData(result);
        setHasMore(pageHasMore(route.page, result));
      })
      .catch((error) => {
        if (!cancelled && !controller.signal.aborted) {
          if (isConnectionFailure(error)) setConnectionState("reconnecting");
          setPageError(
            error instanceof Error
              ? error.message
              : "Could not load your library.",
          );
        }
      })
      .finally(() => {
        if (!cancelled && generation === loadGeneration.current)
          setPending(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    client,
    localMusic,
    sourceMode,
    route,
    debouncedQuery,
    sort,
    reload,
    experimentalArtworkLoading,
    refreshCollectionOnVisit,
  ]);

  const loadMore = useCallback(async () => {
    if (!client || loadingMore) return;

    if (sourceMode === "local") {
      setRenderLimit((old) => old + 100);
      return;
    }

    if (route.page === "artists") {
      if (!experimentalArtworkLoading) {
        setRenderLimit((old) => old + 60);
        return;
      }
      setLoadingMore(true);
      try {
        const nextArtists = data.artists.slice(renderLimit, renderLimit + 60);
        void Promise.allSettled(
          nextArtists.map((artist) =>
            prefetchArtwork(
              client,
              artist.coverArt,
              artist.artistImageUrl,
              300,
            ),
          ),
        );
        setRenderLimit((old) => old + 60);
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    if (route.page === "favorites") {
      if (!experimentalArtworkLoading) {
        setRenderLimit((old) => old + 100);
        return;
      }
      setLoadingMore(true);
      try {
        const nextSongs = data.songs.slice(renderLimit, renderLimit + 100);
        void preparePageArtwork(
          client,
          { ...EMPTY, songs: nextSongs },
          route.page,
        );
        setRenderLimit((old) => old + 100);
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    const generation = loadGeneration.current;
    setLoadingMore(true);
    try {
      if (route.page === "search") {
        const results = await client.search(debouncedQuery, {
          artistOffset: data.artists.length,
          albumOffset: data.albums.length,
          songOffset: data.songs.length,
        });
        if (generation !== loadGeneration.current) return;
        if (experimentalArtworkLoading)
          void preparePageArtwork(
            client,
            {
              ...EMPTY,
              artists: results.artist,
              albums: results.album,
              songs: results.song,
            },
            route.page,
          );
        if (generation !== loadGeneration.current) return;
        setData((old) => ({
          ...old,
          artists: [...old.artists, ...results.artist],
          albums: [...old.albums, ...results.album],
          songs: [...old.songs, ...results.song],
        }));
        setHasMore(
          results.artist.length === SEARCH_ARTIST_PAGE_SIZE ||
            results.album.length === SEARCH_ALBUM_PAGE_SIZE ||
            results.song.length === SEARCH_SONG_PAGE_SIZE,
        );
      } else if (route.page === "songs") {
        const songs = await client.songs(data.songs.length, 100);
        if (generation !== loadGeneration.current) return;
        if (experimentalArtworkLoading)
          void preparePageArtwork(client, { ...EMPTY, songs }, route.page);
        if (generation !== loadGeneration.current) return;
        setData((old) => ({ ...old, songs: [...old.songs, ...songs] }));
        setHasMore(songs.length === 100);
      } else {
        const albums = await client.albums(
          route.page === "recent"
            ? "newest"
            : route.page === "played"
              ? "recent"
              : sort,
          60,
          data.albums.length,
        );
        if (generation !== loadGeneration.current) return;
        if (experimentalArtworkLoading)
          void preparePageArtwork(client, { ...EMPTY, albums }, route.page);
        if (generation !== loadGeneration.current) return;
        setData((old) => ({ ...old, albums: [...old.albums, ...albums] }));
        setHasMore(albums.length === 60);
      }
    } catch {
      notify("Could not load more. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }, [
    client,
    data.artists,
    data.albums.length,
    data.songs,
    data.songs.length,
    loadingMore,
    notify,
    renderLimit,
    route.page,
    debouncedQuery,
    sort,
    experimentalArtworkLoading,
    sourceMode,
  ]);
  const isFavorite = useCallback(
    (song: Song) => favorites[song.id] ?? Boolean(song.starred),
    [favorites],
  );
  const favorite = useCallback(async (song: Song) => {
    const wasFavorite = isFavorite(song);
    const noteFavorite = (active: boolean) => {
      recordEngagement({
        kind: active ? "favorite-add" : "favorite-remove",
        entity: engagementEntityForSong(song),
      });
      // Saving a song is one of the strongest taste statements available.
      learnFromOutcome(rewardTargetForSong(song), active ? 1 : -0.5);
    };
    if (isLocalSong(song)) {
      setFavorites((current) => {
        const next = { ...current, [song.id]: !wasFavorite };
        safeWrite(
          localStorage,
          LOCAL_FAVORITES_KEY,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(next).filter(
                ([key, value]) => key.startsWith("local:") && value,
              ),
            ),
          ),
        );
        return next;
      });
      noteFavorite(!wasFavorite);
      return;
    }
    if (!client || favoritePending.has(song.id)) return;
    setFavoritePending((old) => new Set(old).add(song.id));
    try {
      await client.star(song, wasFavorite);
      setFavorites((old) => ({ ...old, [song.id]: !wasFavorite }));
      noteFavorite(!wasFavorite);
    } catch {
      notify("Could not update this favorite. Try again.");
    } finally {
      setFavoritePending((old) => {
        const next = new Set(old);
        next.delete(song.id);
        return next;
      });
    }
  }, [
    client,
    favoritePending,
    isFavorite,
    learnFromOutcome,
    notify,
    recordEngagement,
  ]);
  const refreshPlaylistNavigation = useCallback(async () => {
    if (!client || sourceMode === "local") return [];
    const playlists = await client.playlists();
    setSidebarPlaylists(playlists);
    return playlists;
  }, [client, sourceMode]);
  const invalidatePlaylistPage = useCallback((id: string) => {
    for (const key of pageMemory.current.keys()) {
      if (key.startsWith(`playlist\u001f${id}\u001f`))
        pageMemory.current.delete(key);
    }
  }, []);
  const savePlaylist = useCallback(async () => {
    if (
      !playlistDraft ||
      !client ||
      sourceMode === "local" ||
      playlistMutationBusy
    )
      return;
    const name = playlistDraft.name.trim();
    if (!name) {
      notify("Give this playlist a name first.");
      return;
    }
    setPlaylistMutationBusy(true);
    try {
      if (playlistDraft.playlist) {
        await client.updatePlaylist(playlistDraft.playlist.id, { name });
        await refreshPlaylistNavigation();
        requestRefresh();
        notify("Playlist renamed.");
      } else {
        const created = await client.createPlaylist(
          name,
          playlistDraft.song ? [playlistDraft.song.id] : [],
        );
        await refreshPlaylistNavigation();
        if (created)
          navigate({ page: "playlist", id: created.id, title: created.name });
        else {
          requestRefresh();
          navigate({ page: "playlists" });
        }
        notify(
          playlistDraft.song
            ? `Added “${playlistDraft.song.title}” to a new playlist.`
            : "Playlist created.",
        );
        if (playlistDraft.song) {
          recordEngagement({
            kind: "playlist-add",
            entity: engagementEntityForSong(playlistDraft.song),
          });
          learnFromOutcome(rewardTargetForSong(playlistDraft.song), 0.9);
        }
      }
      setPlaylistDraft(null);
    } catch (error) {
      notify(
        error instanceof Error
          ? `Could not save playlist: ${error.message}`
          : "Could not save playlist. Try again.",
      );
    } finally {
      setPlaylistMutationBusy(false);
    }
  }, [
    client,
    learnFromOutcome,
    navigate,
    notify,
    playlistDraft,
    playlistMutationBusy,
    recordEngagement,
    refreshPlaylistNavigation,
    requestRefresh,
    sourceMode,
  ]);
  const addSongToPlaylist = useCallback(async (
    playlist: Playlist,
    song: Song,
  ) => {
    if (!client || sourceMode === "local" || playlistMutationBusy) return;
    setPlaylistMutationBusy(true);
    try {
      await client.updatePlaylist(playlist.id, { songIdsToAdd: [song.id] });
      await refreshPlaylistNavigation();
      invalidatePlaylistPage(playlist.id);
      if (route.page === "playlist" && route.id === playlist.id) requestRefresh();
      setPlaylistPickerSong(null);
      recordEngagement({
        kind: "playlist-add",
        entity: engagementEntityForSong(song),
      });
      learnFromOutcome(rewardTargetForSong(song), 0.85);
      notify(`Added “${song.title}” to ${playlist.name}.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? `Could not update playlist: ${error.message}`
          : "Could not update playlist. Try again.",
      );
    } finally {
      setPlaylistMutationBusy(false);
    }
  }, [
    client,
    notify,
    invalidatePlaylistPage,
    learnFromOutcome,
    playlistMutationBusy,
    recordEngagement,
    refreshPlaylistNavigation,
    requestRefresh,
    route.id,
    route.page,
    sourceMode,
  ]);
  const removeSongFromPlaylist = useCallback(async (
    playlist: Playlist,
    index: number,
  ) => {
    if (!client || sourceMode === "local" || playlistMutationBusy) return;
    setPlaylistMutationBusy(true);
    try {
      await client.updatePlaylist(playlist.id, { songIndexesToRemove: [index] });
      await refreshPlaylistNavigation();
      requestRefresh();
      notify("Song removed from playlist.");
    } catch (error) {
      notify(
        error instanceof Error
          ? `Could not update playlist: ${error.message}`
          : "Could not update playlist. Try again.",
      );
    } finally {
      setPlaylistMutationBusy(false);
    }
  }, [
    client,
    notify,
    playlistMutationBusy,
    refreshPlaylistNavigation,
    requestRefresh,
    sourceMode,
  ]);
  const deletePlaylist = useCallback(async () => {
    if (!playlistToDelete || !client || sourceMode === "local") return;
    setPlaylistMutationBusy(true);
    try {
      await client.deletePlaylist(playlistToDelete.id);
      await refreshPlaylistNavigation();
      setPlaylistToDelete(null);
      navigate({ page: "playlists" });
      notify("Playlist deleted.");
    } catch (error) {
      notify(
        error instanceof Error
          ? `Could not delete playlist: ${error.message}`
          : "Could not delete playlist. Try again.",
      );
    } finally {
      setPlaylistMutationBusy(false);
    }
  }, [
    client,
    navigate,
    notify,
    playlistToDelete,
    refreshPlaylistNavigation,
    sourceMode,
  ]);
  const loadAlbumSongs = useCallback(async (album: AlbumRecord) => {
    if (!client) return [];
    const full = album.song?.length ? album : await client.album(album.id);
    const coverArt = full.coverArt || album.coverArt;
    return (full.song || []).map((song) =>
      coverArt ? { ...song, coverArt } : song,
    );
  }, [client]);
  const playAlbum = useCallback(async (album: AlbumRecord) => {
    try {
      player.playSongs(await loadAlbumSongs(album));
      recordEngagement({
        kind: "album-play",
        entity: engagementEntityForAlbum(album),
      });
      learnFromOutcome(rewardTargetForAlbum(album), 0.75);
    } catch {
      notify("This album could not be played. Try again.");
    }
  }, [learnFromOutcome, loadAlbumSongs, notify, player.playSongs, recordEngagement]);
  const shuffleAlbum = useCallback(async (album: AlbumRecord) => {
    try {
      player.playSongs(shuffleSongs(await loadAlbumSongs(album)));
      recordEngagement({
        kind: "album-shuffle",
        entity: engagementEntityForAlbum(album),
      });
      learnFromOutcome(rewardTargetForAlbum(album), 0.55);
    } catch {
      notify("This album could not be played. Try again.");
    }
  }, [learnFromOutcome, loadAlbumSongs, notify, player.playSongs, recordEngagement]);
  const queueAlbum = useCallback(async (album: AlbumRecord, next = false) => {
    try {
      const songs = await loadAlbumSongs(album);
      for (const song of next ? [...songs].reverse() : songs)
        player.append(song, next);
      recordEngagement({
        kind: next ? "play-next" : "queue-add",
        entity: engagementEntityForAlbum(album),
      });
      learnFromOutcome(rewardTargetForAlbum(album), next ? 0.45 : 0.3);
      notify(
        next
          ? `${albumName(album)} will play next.`
          : `${albumName(album)} added to the queue.`,
      );
    } catch {
      notify("This album could not be added to the queue. Try again.");
    }
  }, [learnFromOutcome, loadAlbumSongs, notify, player.append, recordEngagement]);
  const queueSong = useCallback(
    (song: Song, next = false) => {
      player.append(song, next);
      recordEngagement({
        kind: next ? "play-next" : "queue-add",
        entity: engagementEntityForSong(song),
      });
      learnFromOutcome(rewardTargetForSong(song), next ? 0.45 : 0.3);
    },
    [learnFromOutcome, player.append, recordEngagement],
  );
  const notInterested = useCallback(
    (target: { song?: Song; album?: AlbumRecord }) => {
      const entity = target.song
        ? engagementEntityForSong(target.song)
        : target.album
          ? engagementEntityForAlbum(target.album)
          : undefined;
      if (!entity) return;
      recordEngagement({ kind: "dislike", entity });
      learnFromOutcome(
        target.song
          ? rewardTargetForSong(target.song)
          : rewardTargetForAlbum(target.album!),
        -1,
      );
      notify("Got it — Volta will show less like this.");
    },
    [learnFromOutcome, notify, recordEngagement],
  );
  const setArtistMuted = useCallback(
    (
      artistId: string | undefined,
      name: string | undefined,
      muted: boolean,
    ) => {
      if (!artistId) return;
      const entity: EngagementEntity = { type: "artist", id: artistId, name };
      recordEngagement({
        kind: muted ? "artist-mute" : "artist-unmute",
        entity,
      });
      notify(
        muted
          ? `Muted ${name || "this artist"} in recommendations.`
          : `Unmuted ${name || "this artist"}.`,
      );
    },
    [notify, recordEngagement],
  );
  const contextItems: ContextMenuItem[] = contextTarget
    ? contextTarget.type === "song"
      ? [
          {
            label: "Play Next",
            icon: <ListPlus size={16} />,
            onSelect: () => queueSong(contextTarget.item, true),
          },
          {
            label: "Add to Queue",
            icon: <ListEnd size={16} />,
            onSelect: () => queueSong(contextTarget.item),
          },
          { separator: true },
          ...(sourceMode === "navidrome"
            ? [
                {
                  label: "Add to Playlist",
                  icon: <ListMusic size={16} />,
                  onSelect: () => setPlaylistPickerSong(contextTarget.item),
                },
                { separator: true as const },
              ]
            : []),
          {
            label: isFavorite(contextTarget.item)
              ? "Remove Favorite"
              : "Favorite",
            icon: <Star size={16} />,
            onSelect: () => void favorite(contextTarget.item),
          },
          {
            label: "Not Interested",
            icon: <ThumbsDown size={16} />,
            onSelect: () => notInterested({ song: contextTarget.item }),
          },
          ...(contextTarget.item.artistId
            ? [
                {
                  label: "Mute This Artist",
                  icon: <Ban size={16} />,
                  onSelect: () =>
                    setArtistMuted(
                      contextTarget.item.artistId,
                      contextTarget.item.artist,
                      true,
                    ),
                },
              ]
            : []),
          { separator: true },
          {
            label: "View Details",
            icon: <Info size={16} />,
            onSelect: () => setDetailsSong(contextTarget.item),
          },
          ...(contextTarget.item.albumId
            ? [
                {
                  label: "Go to Album",
                  icon: <Disc3 size={16} />,
                  onSelect: () => {
                    navigate({
                      page: "album",
                      id: contextTarget.item.albumId,
                      title: contextTarget.item.album,
                    });
                  },
                },
              ]
            : []),
          ...(contextTarget.item.artistId
            ? [
                {
                  label: "Go to Artist",
                  icon: <UserRound size={16} />,
                  onSelect: () => {
                    navigate({
                      page: "artist",
                      id: contextTarget.item.artistId,
                      title: contextTarget.item.artist,
                    });
                  },
                },
              ]
            : []),
        ]
      : [
          {
            label: "Play Album",
            icon: <Play size={16} fill="currentColor" />,
            onSelect: () => void playAlbum(contextTarget.item),
          },
          {
            label: "Shuffle Album",
            icon: <Shuffle size={16} />,
            onSelect: () => void shuffleAlbum(contextTarget.item),
          },
          { separator: true },
          {
            label: "Play Next",
            icon: <ListPlus size={16} />,
            onSelect: () => void queueAlbum(contextTarget.item, true),
          },
          {
            label: "Add to Queue",
            icon: <ListEnd size={16} />,
            onSelect: () => void queueAlbum(contextTarget.item),
          },
          { separator: true },
          {
            label: "Not Interested",
            icon: <ThumbsDown size={16} />,
            onSelect: () => notInterested({ album: contextTarget.item }),
          },
          ...(contextTarget.item.artistId
            ? [
                {
                  label: "Mute This Artist",
                  icon: <Ban size={16} />,
                  onSelect: () =>
                    setArtistMuted(
                      contextTarget.item.artistId,
                      contextTarget.item.artist,
                      true,
                    ),
                },
              ]
            : []),
          { separator: true },
          {
            label: "View Details",
            icon: <Info size={16} />,
            onSelect: () => setDetailsAlbum(contextTarget.item),
          },
          ...(contextTarget.item.artistId
            ? [
                {
                  label: "Go to Artist",
                  icon: <UserRound size={16} />,
                  onSelect: () =>
                    navigate({
                      page: "artist",
                      id: contextTarget.item.artistId,
                      title: contextTarget.item.artist,
                    }),
                },
              ]
            : []),
        ]
    : [];
  const showSearch = () => {
    if (route.page !== "search") navigate({ page: "search" });
  };
  const rememberSearch = useCallback((value: string) => {
    const next = value.trim();
    if (!next) return;
    recordEngagement({ kind: "search", text: next });
    setSearchHistory((current) => [
      next,
      ...current.filter((item) => item.toLowerCase() !== next.toLowerCase()),
    ].slice(0, 8));
  }, [recordEngagement]);
  const focusSearchResult = (direction: 1 | -1) => {
    const results = [
      ...document.querySelectorAll<HTMLElement>(
        '#main-content [data-search-result="true"]',
      ),
    ];
    if (!results.length) return false;
    const current = results.indexOf(document.activeElement as HTMLElement);
    const next =
      current < 0
        ? direction > 0
          ? 0
          : results.length - 1
        : (current + direction + results.length) % results.length;
    results[next]?.focus();
    return true;
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // Scale preview owns the resize keys so browsing the app stays usable.
      if (scalePreview !== null) {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === "Escape") {
          event.preventDefault();
          cancelInterfaceScalePreview();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          confirmInterfaceScalePreview();
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          adjustInterfaceScale(step);
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          adjustInterfaceScale(-step);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          setPreviewInterfaceScale(70);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          setPreviewInterfaceScale(150);
          return;
        }
      }
      if (
        target.closest(
          '[role="dialog"], [role="menu"]',
        )
      )
        return;
      const resultNavigationKey = [
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
      ].includes(event.key);
      const onResult = Boolean(target.closest('[data-search-result="true"]'));
      const onInteractiveControl = Boolean(
        target.closest(
          'input, textarea, select, button, [contenteditable="true"]',
        ),
      );
      if (
        resultNavigationKey &&
        (onResult || !onInteractiveControl) &&
        focusSearchResult(
          event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1,
        )
      ) {
        event.preventDefault();
        return;
      }
      const shortcut = SHORTCUT_DEFINITIONS.find((definition) =>
        shortcutMatches(event, shortcuts[definition.id]),
      );
      if (!shortcut) return;
      if (
        target.closest(
          'input, textarea, select, button, [contenteditable="true"]',
        ) &&
        !shortcuts[shortcut.id].mod
      )
        return;
      event.preventDefault();
      switch (shortcut.id) {
        case "playPause":
          if (client) player.toggle();
          break;
        case "previousTrack":
          player.previous();
          break;
        case "nextTrack":
          player.next();
          break;
        case "seekBackward":
          player.seek(player.currentTime - 10);
          break;
        case "seekForward":
          player.seek(player.currentTime + 10);
          break;
        case "volumeDown":
          player.setVolume(player.volume - 0.05);
          break;
        case "volumeUp":
          player.setVolume(player.volume + 0.05);
          break;
        case "mute":
          player.setVolume(player.volume ? 0 : 0.8);
          break;
        case "shuffle":
          player.toggleShuffle();
          break;
        case "repeat":
          player.cycleRepeat();
          break;
        case "favorite":
          if (player.currentSong) void favorite(player.currentSong);
          break;
        case "focusSearch":
          setMobileSidebar(true);
          showSearch();
          searchRef.current?.focus();
          break;
        case "focusFilter":
          filterRef.current?.focus();
          break;
        case "toggleSidebar":
          setMobileSidebar((open) => !open);
          break;
        case "goHome":
          navigate({ page: "home" });
          break;
        case "goRecent":
          navigate({ page: "recent" });
          break;
        case "goPlayed":
          navigate({ page: "played" });
          break;
        case "goAlbums":
          navigate({ page: "albums" });
          break;
        case "goArtists":
          navigate({ page: "artists" });
          break;
        case "goSongs":
          navigate({ page: "songs" });
          break;
        case "goFavorites":
          navigate({ page: "favorites" });
          break;
        case "goPlaylists":
          navigate({ page: "playlists" });
          break;
        case "goBack":
          back();
          break;
        case "refresh":
          requestRefresh();
          break;
        case "scrollTop":
          pageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          break;
        case "toggleQueue":
          setPanel((old) => (old === "queue" ? null : "queue"));
          break;
        case "toggleLyrics":
          setPanel((old) => (old === "lyrics" ? null : "lyrics"));
          break;
        case "openPlayer":
          openFullPlayer();
          break;
        case "openSettings":
          setShortcutsOpen(false);
          navigate({ page: "settings" });
          break;
        case "openShortcuts":
          setShortcutQuery("");
          setRecordingShortcut(null);
          setShortcutsOpen(true);
          break;
        case "closeOverlays":
          closeFullPlayer();
          setPanel(null);
          setMobileSidebar(false);
          setContextTarget(null);
          setShortcutsOpen(false);
          setRecordingShortcut(null);
          break;
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [
    adjustInterfaceScale,
    cancelInterfaceScalePreview,
    client,
    closeFullPlayer,
    confirmInterfaceScalePreview,
    favorite,
    navigate,
    openFullPlayer,
    player,
    route.page,
    scalePreview,
    setPreviewInterfaceScale,
    shortcuts,
    showSearch,
  ]);

  const filteredShortcuts = SHORTCUT_DEFINITIONS.filter((definition) => {
    const search = shortcutQuery.trim().toLowerCase();
    if (!search) return true;
    return [
      definition.category,
      definition.label,
      definition.description,
      formatShortcut(shortcuts[definition.id]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
  const modifierLabel = platformModifierLabel();
  const recordShortcut = (id: ShortcutId, event: ReactKeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (
      [
        "AltLeft",
        "AltRight",
        "ControlLeft",
        "ControlRight",
        "MetaLeft",
        "MetaRight",
        "ShiftLeft",
        "ShiftRight",
        "Tab",
      ].includes(event.code)
    )
      return;
    const binding = bindingFromKeyboardEvent(event.nativeEvent);
    const conflict = SHORTCUT_DEFINITIONS.find(
      (definition) =>
        definition.id !== id &&
        bindingSignature(shortcuts[definition.id]) === bindingSignature(binding),
    );
    if (conflict) {
      notify(`That shortcut is already assigned to “${conflict.label}”.`);
      setRecordingShortcut(null);
      return;
    }
    setShortcuts((current) => ({ ...current, [id]: binding }));
    setRecordingShortcut(null);
  };
  const resetShortcuts = () => {
    setShortcuts(
      Object.fromEntries(
        SHORTCUT_DEFINITIONS.map(({ id, defaultBinding }) => [
          id,
          { ...defaultBinding },
        ]),
      ) as ShortcutBindings,
    );
    notify("Keyboard shortcuts reset to their defaults.");
  };

  const visibleSongs = useMemo(
    () =>
      data.songs.filter(
        (song) =>
          (route.page !== "favorites" ||
            favorites[song.id] ||
            Boolean(song.starred)) &&
          (song.title + " " + song.artist + " " + song.album)
            .toLowerCase()
            .includes(filter.toLowerCase()),
      ),
    [data.songs, favorites, filter, route.page],
  );
  const visibleAlbums = useMemo(
    () =>
      data.albums.filter((album) =>
        (albumName(album) + " " + album.artist)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [data.albums, filter],
  );
  const visibleArtists = useMemo(
    () =>
      data.artists.filter((artist) =>
        artist.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [data.artists, filter],
  );
  const renderedArtists = useMemo(
    () => visibleArtists.slice(0, renderLimit),
    [renderLimit, visibleArtists],
  );
  const renderedSongs = useMemo(
    () =>
      route.page === "favorites" ||
      (sourceMode === "local" && route.page === "songs")
        ? visibleSongs.slice(0, renderLimit)
        : visibleSongs,
    [renderLimit, route.page, sourceMode, visibleSongs],
  );
  const recentlyPlayedAlbums = useMemo(
    () => data.recentlyPlayed.slice(0, 8),
    [data.recentlyPlayed],
  );
  const filteredRecentAlbums = useMemo(
    () =>
      data.recent.filter((album) =>
        (albumName(album) + " " + album.artist)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [data.recent, filter],
  );
  const filteredFrequentAlbums = useMemo(
    () =>
      data.frequent.filter((album) =>
        (albumName(album) + " " + album.artist)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [data.frequent, filter],
  );
  const artistSeeds = useMemo(
    () =>
      topArtistSeeds(
        { listeningProfile, engagementProfile, now: new Date() },
        3,
      ),
    [engagementProfile, listeningProfile],
  );
  const artistSeedSignature = artistSeeds.join("|");
  const [discoveryAlbums, setDiscoveryAlbums] = useState<AlbumRecord[]>([]);
  const discoveryCache = useRef(new Map<string, AlbumRecord[]>());
  // Fetch a little extra material from the artists this listener actually
  // returns to. The server's generic random/recent lists rarely surface deep
  // cuts, so personalization needs its own candidates to rank.
  useEffect(() => {
    if (sourceMode !== "navidrome" || !client || !artistSeeds.length) {
      setDiscoveryAlbums([]);
      return;
    }
    const cached = discoveryCache.current.get(artistSeedSignature);
    if (cached) {
      setDiscoveryAlbums(cached);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const results = await Promise.all(
        artistSeeds.map((id) =>
          client.artist(id, controller.signal).catch(() => null),
        ),
      );
      const albums = mergeRecommendationCandidates(
        ...results.map((artist) => artist?.album ?? []),
      );
      if (cancelled || !albums.length) return;
      discoveryCache.current.set(artistSeedSignature, albums);
      setDiscoveryAlbums(albums);
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [artistSeedSignature, artistSeeds, client, sourceMode]);
  const recommendedResults = useMemo(() => {
    if (sourceMode !== "navidrome") return [];
    const excluded = new Set<string>(
      data.recentlyPlayed.slice(0, 2).map((album) => album.id),
    );
    const queueStart = Math.max(0, player.currentIndex);
    const contextSongs = player.queue
      .slice(queueStart, queueStart + 4)
      .filter((song, index, songs) =>
        songs.findIndex((candidate) => candidate.id === song.id) === index,
      );
    contextSongs.forEach((song) => {
      if (song.albumId) excluded.add(song.albumId);
    });
    return rankAlbumRecommendations({
      candidates: data.recommendationCandidates,
      discoveryCandidates: discoveryAlbums,
      recentlyPlayed: data.recentlyPlayed,
      frequentlyPlayed: data.frequent,
      recentlyAdded: data.recent,
      favoriteAlbumIds: new Set(data.favoriteAlbumIds),
      contextSongs,
      excludeAlbumIds: excluded,
      listeningProfile,
      engagementProfile,
      rankerModel,
      limit: 8,
    });
  }, [
    data.favoriteAlbumIds,
    data.frequent,
    data.recent,
    data.recentlyPlayed,
    data.recommendationCandidates,
    discoveryAlbums,
    engagementProfile,
    listeningProfile,
    player.currentIndex,
    player.queue,
    rankerModel,
    sourceMode,
  ]);
  const recommendedAlbums = useMemo(
    () => recommendedResults.map((recommendation) => recommendation.album),
    [recommendedResults],
  );
  // Log the slate we actually showed, with its feature vectors, so later
  // playback and engagement can teach the local ranker what worked.
  useEffect(() => {
    recommendedAlbumIds.current = new Set(
      recommendedResults.map((recommendation) => recommendation.album.id),
    );
    if (!listeningHistoryEnabled || !impressionKey || !recommendedResults.length)
      return;
    const now = Date.now();
    const bucket = Math.floor(now / (30 * 60 * 1000));
    const impressions: PendingImpression[] = recommendedResults.map(
      (recommendation, index) => ({
        id: `${recommendation.album.id}:${bucket}`,
        at: now,
        albumId: recommendation.album.id.trim().toLowerCase(),
        artistId: (
          recommendation.album.artistId ||
          recommendation.album.artist ||
          ""
        )
          .trim()
          .toLowerCase(),
        genres: splitGenres(recommendation.album.genre).map((genre) =>
          genre.toLowerCase(),
        ),
        features: recommendation.features,
        position: index,
      }),
    );
    impressionsRef.current = writeImpressions(
      listeningStorage,
      impressionKey,
      [...impressionsRef.current, ...impressions.filter(
        (item) => !impressionsRef.current.some((existing) => existing.id === item.id),
      )],
    );
  }, [
    impressionKey,
    listeningHistoryEnabled,
    listeningStorage,
    recommendedResults,
  ]);
  const addInfinitePlay = useCallback(async () => {
    if (!client || sourceMode === "local" || infinitePlayBusy) return;
    setInfinitePlayBusy(true);
    try {
      const existing = new Set(player.queue.map((song) => song.id));
      let candidates: Song[] = [];
      if (infinitePlayMode === "random") {
        candidates = await client.randomSongs(infinitePlayCount);
      } else {
        const albums = recommendedAlbums.slice(0, Math.max(8, infinitePlayCount));
        const details = await Promise.all(
          albums.map((album) => client.album(album.id).catch(() => null)),
        );
        const albumSongs = details.map((album) => album?.song ?? []);
        const seen = new Set<string>();
        for (let offset = 0; candidates.length < infinitePlayCount; offset += 1) {
          let addedThisRound = false;
          for (const songs of albumSongs) {
            const song = songs[offset % songs.length];
            if (!song || seen.has(song.id) || existing.has(song.id)) continue;
            seen.add(song.id);
            candidates.push(song);
            addedThisRound = true;
            if (candidates.length >= infinitePlayCount) break;
          }
          if (!addedThisRound) break;
        }
      }
      const additions = candidates
        .filter((song) => !existing.has(song.id))
        .slice(0, infinitePlayCount);
      additions.forEach((song) => {
        existing.add(song.id);
        infinitePlaySongIds.current.add(song.id);
        player.append(song);
      });
      if (additions.length) {
        setNotice(
          `${additions.length} song${additions.length === 1 ? "" : "s"} added to queue`,
        );
      }
    } catch {
      setNotice("Infinite Play could not load more songs.");
    } finally {
      setInfinitePlayBusy(false);
    }
  }, [
    client,
    infinitePlayBusy,
    infinitePlayCount,
    infinitePlayMode,
    player,
    recommendedAlbums,
    sourceMode,
  ]);
  const removeInfinitePlaySongs = useCallback(() => {
    const ownedIds = infinitePlaySongIds.current;
    if (!ownedIds.size) return;
    player.queue
      .map((song, index) =>
        index > player.currentIndex && ownedIds.has(song.id) ? index : -1,
      )
      .filter((index) => index >= 0)
      .reverse()
      .forEach((index) => player.removeFromQueue(index));
    ownedIds.clear();
    infinitePlayAttempt.current = "";
  }, [player]);
  const toggleInfinitePlay = useCallback(() => {
    setInfinitePlayEnabled((enabled) => {
      const next = !enabled;
      if (next) void addInfinitePlay();
      else removeInfinitePlaySongs();
      return next;
    });
  }, [addInfinitePlay, removeInfinitePlaySongs]);
  useEffect(() => {
    if (
      !infinitePlayEnabled ||
      !client ||
      sourceMode === "local" ||
      !player.currentSong
    )
      return;
    const remaining = player.queue.length - player.currentIndex - 1;
    if (remaining > 2) {
      infinitePlayAttempt.current = "";
      return;
    }
    const attemptKey = `${player.queue.length}:${player.currentIndex}`;
    if (infinitePlayAttempt.current === attemptKey) return;
    infinitePlayAttempt.current = attemptKey;
    void addInfinitePlay();
  }, [
    addInfinitePlay,
    client,
    infinitePlayEnabled,
    player.currentIndex,
    player.currentSong,
    player.queue.length,
    sourceMode,
  ]);
  const hasClientMore =
    (route.page === "artists" && renderedArtists.length < visibleArtists.length) ||
    (route.page === "favorites" && renderedSongs.length < visibleSongs.length) ||
    (sourceMode === "local" &&
      route.page === "songs" &&
      renderedSongs.length < visibleSongs.length);
  const canLoadMore = hasMore || hasClientMore;
  const warmArtistArtwork = useCallback(() => {
    if (!client || !experimentalArtworkLoading) return;
    renderedArtists.slice(0, 18).forEach((artist) =>
      prefetchArtwork(
        client,
        artist.coverArt,
        artist.artistImageUrl || artist.localArtworkUrl,
        300,
      ),
    );
  }, [client, experimentalArtworkLoading, renderedArtists]);
  const navWarm = useRef(new Set<string>());
  const warmSection = useCallback((section: "albums" | "artists" | "songs") => {
    if (
      !client ||
      sourceMode === "local" ||
      !experimentalArtworkLoading ||
      navWarm.current.has(section)
    )
      return;
    navWarm.current.add(section);
    const warm = async () => {
      if (section === "artists") {
        const artists = await client.artists();
        await preparePageArtwork(client, { ...EMPTY, artists }, section);
      } else if (section === "songs") {
        const songs = await client.songs(0, 100);
        await preparePageArtwork(client, { ...EMPTY, songs }, section);
      } else {
        const albums = await client.albums(sort, 60);
        await preparePageArtwork(client, { ...EMPTY, albums }, section);
      }
    };
    void warm().catch(() => navWarm.current.delete(section));
  }, [client, experimentalArtworkLoading, sort, sourceMode]);
  useEffect(() => { navWarm.current.clear(); }, [client, sort, sourceMode]);
  const playSongs = useCallback(
    (songs: Song[], index: number) => player.playSongs(songs, index),
    [player.playSongs],
  );
  const openAlbum = useCallback(
    (album: AlbumRecord) =>
      navigate({ page: "album", id: album.id, title: albumName(album) }),
    [navigate],
  );
  const openAlbumById = useCallback(
    (id: string) => navigate({ page: "album", id }),
    [navigate],
  );
  if (!client && (remembered || sessionCredentials) && !authReady)
    return (
      <main className="connect-screen session-loading" aria-busy="true">
        <div className="connect-brand">
          <img className="brand-bolt" src="/volta-bolt.svg" alt="" />
          <span>Volta</span>
        </div>
        <div className="session-loading-content">
          <LoaderCircle className="spin" size={24} />
          <span>Restoring your session…</span>
        </div>
      </main>
    );
  if (!client)
    return (
      <Connect
        onConnect={connect}
        busy={connecting}
        error={connectionError}
        localMusic={localMusic}
        localMusicBusy={localMusicBusy}
        localMusicError={localMusicError}
        localMusicInputRef={localMusicInputRef}
        onChooseLocalMusic={chooseMusicFolder}
        onImportLocalMusic={importMusicFolder}
        onOpenLocalMusic={openLocalLibrary}
      />
    );
  const canEditPlaylist = Boolean(
    sourceMode === "navidrome" &&
      data.playlist &&
      !data.playlist.readonly &&
      (!data.playlist.owner || data.playlist.owner === account.username),
  );
  const songTable = (
    songs: Song[],
    compact = false,
    resultNavigation = true,
    playlist?: Playlist,
  ) => (
    <TrackTable
      songs={songs}
      client={client}
      currentId={player.currentSong?.id}
      playing={player.playing}
      onPlay={playSongs}
      onQueue={queueSong}
      onFavorite={favorite}
      isFavorite={isFavorite}
      onAlbum={openAlbumById}
      onContextMenu={openSongContextMenu}
      onAddToPlaylist={
        sourceMode === "navidrome" ? setPlaylistPickerSong : undefined
      }
      onRemoveFromPlaylist={
        playlist && canEditPlaylist
          ? (_song, index) => void removeSongFromPlaylist(playlist, index)
          : undefined
      }
      compact={compact}
      resultNavigation={resultNavigation}
    />
  );
  const albumGrid = (
    albums: AlbumRecord[],
    shelf = false,
    featured = false,
    resultNavigation = true,
  ) => (
    <AlbumGrid
      albums={albums}
      client={client}
      onOpen={openAlbum}
      onPlay={playAlbum}
      onContextMenu={openAlbumContextMenu}
      shelf={shelf}
      featured={featured}
      resultNavigation={resultNavigation}
    />
  );
  const genreBrowser = (selectedGenre: string | null, routed: boolean) => (
    <SearchGenres
      key={`${sourceMode}:${client.server}:${selectedGenre || "browse"}`}
      client={client}
      library={sourceMode === "local" ? localMusic : null}
      selectedGenre={selectedGenre}
      onSelectGenre={(genre) => navigate({ page: "genre", id: genre, title: genre })}
      onBackToGenres={routed ? () => navigate({ page: "search" }) : undefined}
      onOpenAlbum={openAlbum}
      onPlayAlbum={playAlbum}
      onPlay={(songs) => player.playSongs(songs)}
      onShuffle={(songs) => player.playSongs(shuffleSongs(songs))}
    />
  );
  const artistGrid = (artists: Artist[]) => (
    <div className="artist-grid">
      {artists.map((artist) => (
        <button
          className="artist-card"
          data-search-result="true"
          key={artist.id}
          onClick={() =>
            navigate({ page: "artist", id: artist.id, title: artist.name })
          }
        >
          <Artwork
            client={client}
            id={artist.coverArt}
            imageUrl={artist.artistImageUrl || artist.localArtworkUrl}
            size={300}
          />
          <b>{artist.name}</b>
          <span>{artist.albumCount || 0} albums</span>
        </button>
      ))}
    </div>
  );
  const isDetail = ["album", "artist", "playlist", "genre"].includes(route.page);
  const title = data.album
    ? albumName(data.album)
    : data.artist?.name ||
      data.playlist?.name ||
      (route.page === "genre" ? route.id : undefined) ||
      route.title ||
      TITLES[route.page];
  const active = (page: Page) => (route.page === page ? "selected" : "");

  // Portaled to <body> so it sits outside the zoomed #root subtree. That is what
  // keeps the preview slider a fixed size no matter what scale is being applied.
  const scalePreviewOverlay =
    scalePreview === null
      ? null
      : createPortal(
          <div
            className="scale-preview"
            role="region"
            aria-label="Interface scale preview"
          >
            <div className="scale-preview-main">
              <div className="scale-preview-head">
                <span className="scale-preview-badge">Preview</span>
                <output
                  className="scale-preview-value"
                  htmlFor="scale-preview-range"
                >
                  {scalePreview}%
                </output>
              </div>
              <p className="scale-preview-hint">
                Use ← and → (hold Shift for 10%) or drag the slider. Browse
                around to see how it feels, then keep or cancel.
              </p>
              <div className="scale-preview-controls">
                <button
                  type="button"
                  className="scale-preview-step"
                  aria-label="Decrease interface scale"
                  onClick={() => adjustInterfaceScale(-1)}
                >
                  −
                </button>
                <input
                  id="scale-preview-range"
                  className="scale-preview-slider"
                  aria-label="Interface scale"
                  type="range"
                  min="70"
                  max="150"
                  step="1"
                  value={scalePreview}
                  onChange={(event) =>
                    setPreviewInterfaceScale(Number(event.target.value))
                  }
                />
                <button
                  type="button"
                  className="scale-preview-step"
                  aria-label="Increase interface scale"
                  onClick={() => adjustInterfaceScale(1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="scale-preview-actions">
              <button className="secondary-button" onClick={cancelInterfaceScalePreview}>
                Cancel
              </button>
              <button className="primary-button" onClick={confirmInterfaceScalePreview}>
                Keep {scalePreview}%
              </button>
            </div>
          </div>,
          document.body,
        );

  return (
    <ArtworkMotionProvider
      enabled={animatedArtwork}
      everywhere={animateArtworkEverywhere}
      experimentalLoading={experimentalArtworkLoading}
    >
      <div
      className={
        "desktop-app" +
        (floatingSidebar ? " floating-sidebar" : "") +
        (panel ? " inspector-open" : "") +
        (mobileSidebar ? " sidebar-open" : "")
      }
    >
      {connectionState !== "online" && (
        <div
          className={`connection-banner ${connectionState}`}
          role="status"
          aria-live="polite"
        >
          {connectionState === "reconnecting" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <span aria-hidden="true">!</span>
          )}
          <span>
            {connectionState === "reconnecting"
              ? "Reconnecting to Navidrome…"
              : "You’re offline. Volta will reconnect when the network returns."}
          </span>
          <button
            className="secondary-button"
            onClick={() => void retryConnection()}
            disabled={connectionState === "reconnecting"}
          >
            Retry
          </button>
        </div>
      )}
      {mobileSidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileSidebar(false)}
        />
      )}
      <aside className="library-sidebar">
        <div className="sidebar-brand">
          <img className="brand-bolt" src="/volta-bolt.svg" alt="" />
          <span>Volta</span>
          {isBetaHost && <small className="beta-brand-label">(beta)</small>}
          <IconButton
            label="Close navigation"
            onClick={() => setMobileSidebar(false)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <button className={"sidebar-search sidebar-search-button" + (["search", "genre"].includes(route.page) ? " selected" : "")}
          aria-current={["search", "genre"].includes(route.page) ? "page" : undefined}
          onClick={() => { showSearch(); setMobileSidebar(false); searchRef.current?.focus(); }}>
          <Search size={15} />
          <span>Search</span>
          <kbd aria-hidden="true">{modifierLabel} K</kbd>
        </button>
        <nav aria-label="Music navigation">
          <button
            className={active("home")}
            onClick={() => navigate({ page: "home" })}
          >
            <House />
            Home
          </button>
          <button
            className={active("recent")}
            onClick={() => navigate({ page: "recent" })}
          >
            <Grid2X2 />
            New in Your Library
          </button>
          <h2>Library</h2>
          <button
            className={active("albums")}
            onPointerEnter={() => warmSection("albums")}
            onFocus={() => warmSection("albums")}
            onClick={() => navigate({ page: "albums" })}
          >
            <Disc3 />
            Albums
          </button>
          <button
            className={active("artists")}
            onPointerEnter={() => warmSection("artists")}
            onFocus={() => warmSection("artists")}
            onClick={() => navigate({ page: "artists" })}
          >
            <Mic2 />
            Artists
          </button>
          <button
            className={active("songs")}
            onPointerEnter={() => warmSection("songs")}
            onFocus={() => warmSection("songs")}
            onClick={() => navigate({ page: "songs" })}
          >
            <Music2 />
            Songs
          </button>
          <button
            className={active("favorites")}
            onClick={() => navigate({ page: "favorites" })}
          >
            <Star />
            Favorite Songs
          </button>
          <h2>Playlists</h2>
          <button
            className={active("playlists")}
            onClick={() => navigate({ page: "playlists" })}
          >
            <ListMusic />
            All Playlists
          </button>
          {sourceMode === "navidrome" && sidebarPlaylists.map((playlist) => (
            <button
              key={playlist.id}
              className={
                route.page === "playlist" && route.id === playlist.id
                  ? "selected"
                  : ""
              }
              onClick={() =>
                navigate({
                  page: "playlist",
                  id: playlist.id,
                  title: playlist.name,
                })
              }
            >
              <Artwork client={client} id={playlist.coverArt} size={60} eager />
              <span>{playlist.name}</span>
            </button>
          ))}
        </nav>
        <a
          className="version-switch-link"
          href={alternateVersionUrl}
          target="_blank"
          rel="opener"
        >
          Try the {isBetaHost ? "stable" : "beta"} version <span aria-hidden="true">→</span>
        </a>
        <button
          className={"settings-button" + (route.page === "settings" ? " selected" : "")}
          aria-current={route.page === "settings" ? "page" : undefined}
          onClick={() => navigate({ page: "settings" })}
        >
          <Settings2 size={17} />
          <span>Settings</span>
          <ChevronRight size={15} className="settings-button-chevron" />
        </button>
        <div className="account-button">
          <CircleUserRound size={26} />
          <span>
            {account.username}
            <small>{sourceMode === "local" ? "This device" : "Navidrome"}</small>
          </span>
        </div>
      </aside>

      <div className="workspace">
        <header className={"window-toolbar" + (["search", "genre"].includes(route.page) ? " search-toolbar" : "")}>
          <div className="toolbar-leading">
            <IconButton
              label="Toggle navigation"
              onClick={() => setMobileSidebar(!mobileSidebar)}
            >
              <PanelLeft size={18} />
            </IconButton>
            <IconButton
              label="Back"
              disabled={history.length < 2}
              onClick={back}
            >
              <ChevronLeft size={22} />
            </IconButton>
            <span>{route.page === "settings" ? "Settings" : isDetail ? title : "Your Library"}</span>
          </div>
          <div className="toolbar-trailing">
            {route.page === "settings" ? null : (
              <>
                {(["search", "genre"].includes(route.page)) ? (
                  <>
                    <label className="search-page-field">
                      <Search size={16} />
                      <input ref={searchRef} autoFocus={route.page === "search"} aria-label="Search library" placeholder="Search" value={query}
                        onChange={(event) => route.page === "genre"
                          ? navigate({ page: "search" }, event.target.value)
                          : setQuery(event.target.value)}
                        onBlur={() => rememberSearch(query)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            focusSearchResult(event.key === "ArrowDown" ? 1 : -1);
                          } else if (event.key === "Enter") rememberSearch(query);
                        }} />
                    </label>
                    <span className="scope-chip">Your Library</span>
                  </>
                ) : (
                  <label className="filter-field">
                    <Search size={14} />
                    <input
                      ref={filterRef}
                      aria-label="Filter this view"
                      placeholder={
                        isDetail
                          ? "Find in " +
                            (route.page === "playlist" ? "Playlist" : "Album")
                          : "Filter"
                      }
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </label>
                )}
                <IconButton
                  label="Refresh view"
                  onClick={requestRefresh}
                >
                  <RefreshCw size={16} />
                </IconButton>
              </>
            )}
          </div>
        </header>
        <main
          ref={pageRef}
          className="main-content"
          id="main-content"
          aria-busy={pending}
        >
          {pending && data !== EMPTY && route.page !== "settings" && (
            <div className="view-refreshing" role="status" aria-label="Updating library">
              <LoaderCircle className="spin" size={15} />
            </div>
          )}
          {pending && data === EMPTY && route.page !== "search" && route.page !== "settings" ? (
            <LoadingState />
          ) : pageError ? (
            <EmptyState title="Unable to load music" message={pageError}>
              <button
                className="primary-button"
                onClick={requestRefresh}
              >
                Try Again
              </button>
            </EmptyState>
          ) : (
            <>
              {!isDetail && route.page !== "settings" && !(route.page === "search" && !debouncedQuery) && (
                <div className="page-heading">
                  <h1>
                    {route.page === "search" && debouncedQuery
                      ? "Search results for “" + debouncedQuery + "”"
                      : TITLES[route.page]}
                  </h1>
                  {route.page === "albums" && (
                    <label className="sort-control">
                      <ArrowDownWideNarrow size={16} />
                      <select
                        aria-label="Sort albums"
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        <option value="alphabeticalByName">Album</option>
                        <option value="alphabeticalByArtist">Artist</option>
                        <option value="newest">Recently Added</option>
                        <option value="frequent">Most Played</option>
                      </select>
                    </label>
                  )}
                  {route.page === "playlists" && sourceMode === "navidrome" && (
                    <button
                      className="secondary-button"
                      onClick={() => setPlaylistDraft({ name: "" })}
                    >
                      <ListPlus size={15} />
                      New Playlist
                    </button>
                  )}
                </div>
              )}
              {route.page === "settings" && (
                <div className="settings-view">
                  <header className="settings-hero">
                    <div className="settings-hero-copy">
                      <p className="settings-hero-kicker">Preferences</p>
                      <h1>Settings</h1>
                      <p>
                        Tune how Volta looks, plays, and personalizes music for
                        you. Everything below stays on this device.
                      </p>
                    </div>
                    <div className="settings-hero-account">
                      <CircleUserRound size={30} />
                      <div>
                        <b>{account.username}</b>
                        <span>
                          {sourceMode === "local" ? "This device" : account.server}
                        </span>
                      </div>
                    </div>
                  </header>

                  <div className="settings-sections">
                    <section className="settings-section">
                      <div className="settings-section-heading">
                        <h2>Appearance</h2>
                        <p>Shape the look and motion of the player.</p>
                      </div>
                      <div className="settings-rows">
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>Theme</b>
                            <small>Choose the color scheme</small>
                          </span>
                          <select
                            aria-label="Theme"
                            value={theme}
                            onChange={(event) => setTheme(event.target.value)}
                          >
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                            <option value="high-contrast">High contrast</option>
                          </select>
                        </label>
                        <div className="setting-row setting-toggle">
                          <span>
                            <b>Floating sidebar</b>
                            <small>Inset navigation with rounded corners</small>
                          </span>
                          <input
                            aria-label="Floating sidebar"
                            type="checkbox"
                            checked={floatingSidebar}
                            onChange={(event) => {
                              setFloatingSidebar(event.target.checked);
                              safeWrite(
                                localStorage,
                                "volta-floating-sidebar",
                                String(event.target.checked),
                              );
                            }}
                          />
                        </div>
                        <div className="setting-row setting-action-row">
                          <span>
                            <b>Interface scale</b>
                            <small>
                              Currently {interfaceScale}%. Open a full-screen
                              preview to try a size before you keep it.
                            </small>
                          </span>
                          <button
                            className="secondary-button"
                            onClick={beginInterfaceScalePreview}
                          >
                            <Eye size={15} />
                            Preview scale
                          </button>
                        </div>
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>Animated artwork</b>
                            <small>Choose where animated artwork is allowed to play</small>
                          </span>
                          <select
                            aria-label="Animated artwork"
                            value={
                              !animatedArtwork
                                ? "off"
                                : animateArtworkEverywhere
                                  ? "everywhere"
                                  : "prominent"
                            }
                            onChange={(event) => {
                              const mode = event.target.value;
                              setAnimatedArtwork(mode !== "off");
                              setAnimateArtworkEverywhere(mode === "everywhere");
                            }}
                          >
                            <option value="prominent">Album and player views</option>
                            <option value="everywhere">Everywhere</option>
                            <option value="off">Off</option>
                          </select>
                        </label>
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>Experimental artwork loading</b>
                            <small>Try aggressive artwork preloading</small>
                          </span>
                          <input
                            aria-label="Experimental artwork loading"
                            type="checkbox"
                            checked={experimentalArtworkLoading}
                            onChange={(event) =>
                              setExperimentalArtworkLoading(event.target.checked)
                            }
                          />
                        </label>
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>Refresh collection on Home visits</b>
                            <small>Change “From Your Collection” every time Home opens</small>
                          </span>
                          <input
                            aria-label="Refresh collection on Home visits"
                            type="checkbox"
                            checked={refreshCollectionOnVisit}
                            onChange={(event) =>
                              setRefreshCollectionOnVisit(event.target.checked)
                            }
                          />
                        </label>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="settings-section-heading">
                        <h2>Playback</h2>
                        <p>Streaming, queue behavior, and session handling.</p>
                      </div>
                      <div className="settings-rows">
                        <label className="setting-row">
                          <span>
                            <b>Streaming quality</b>
                            <small>
                              Original sends the source file to your browser
                            </small>
                          </span>
                          <select
                            aria-label="Streaming quality"
                            value={player.original ? "original" : "compatible"}
                            onChange={(event) =>
                              player.setOriginal(event.target.value === "original")
                            }
                          >
                            <option value="original">Original · no transcoding</option>
                            <option value="compatible">Compatible · MP3 320 kbps</option>
                          </select>
                        </label>
                        <div className="setting-row setting-toggle">
                          <span>
                            <b>Infinite Play</b>
                            <small>Keep the queue filled automatically as it gets low</small>
                          </span>
                          <input
                            aria-label="Infinite Play"
                            type="checkbox"
                            checked={infinitePlayEnabled}
                            disabled={infinitePlayBusy}
                            onChange={toggleInfinitePlay}
                          />
                        </div>
                        <div className="setting-row setting-toggle">
                          <span>
                            <b>Infinite Play songs</b>
                            <small>Choose how many tracks are added from the floating bar</small>
                          </span>
                          <span className="setting-stepper" aria-label="Infinite Play song count">
                            <button
                              type="button"
                              aria-label="Decrease Infinite Play song count"
                              onClick={() =>
                                setInfinitePlayCount((value) => Math.max(1, value - 1))
                              }
                            >
                              −
                            </button>
                            <output>{infinitePlayCount}</output>
                            <button
                              type="button"
                              aria-label="Increase Infinite Play song count"
                              onClick={() =>
                                setInfinitePlayCount((value) => Math.min(200, value + 1))
                              }
                            >
                              +
                            </button>
                          </span>
                        </div>
                        <div className="setting-row setting-toggle">
                          <span>
                            <b>Infinite Play source</b>
                            <small>Use your recommendations or choose songs randomly</small>
                          </span>
                          <select
                            aria-label="Infinite Play source"
                            value={infinitePlayMode}
                            onChange={(event) =>
                              setInfinitePlayMode(event.target.value as InfinitePlayMode)
                            }
                          >
                            <option value="algorithm">Algorithm suggestions</option>
                            <option value="random">Random songs</option>
                          </select>
                        </div>
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>Warn before leaving while playing</b>
                            <small>Ask for confirmation before closing or leaving Volta</small>
                          </span>
                          <input
                            aria-label="Warn before leaving while playing"
                            type="checkbox"
                            checked={warnBeforeLeave}
                            onChange={(event) => setWarnBeforeLeave(event.target.checked)}
                          />
                        </label>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="settings-section-heading">
                        <h2>Privacy</h2>
                        <p>
                          What Volta is allowed to remember locally. Nothing is
                          ever sent to Volta.
                        </p>
                      </div>
                      <div className="settings-rows">
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>External lyrics lookup</b>
                            <small>
                              When your server has no lyrics, look up song metadata
                              with LRCLIB.
                            </small>
                          </span>
                          <input
                            aria-label="External lyrics lookup"
                            type="checkbox"
                            checked={externalLyricsEnabled}
                            onChange={(event) =>
                              setExternalLyricsEnabled(event.target.checked)
                            }
                          />
                        </label>
                        <label className="setting-row setting-toggle">
                          <span>
                            <b>Personalized recommendations</b>
                            <small>
                              Keep local listening time, skips, favorites, searches,
                              album views, and the learned model that ties them
                              together.
                            </small>
                          </span>
                          <input
                            aria-label="Personalized recommendations"
                            type="checkbox"
                            checked={listeningHistoryEnabled}
                            onChange={(event) =>
                              setListeningHistoryEnabled(event.target.checked)
                            }
                          />
                        </label>
                        <div className="setting-row setting-action-row">
                          <span>
                            <b>Listening profile</b>
                            <small>
                              {listeningEvents.length} playback events ·{" "}
                              {engagementEvents.length} interactions ·{" "}
                              {rankerModel.samples} learning samples
                            </small>
                          </span>
                          <div className="setting-action-buttons">
                            <button
                              className="secondary-button"
                              onClick={() => setListeningHistoryOpen(true)}
                            >
                              View profile
                            </button>
                            <button
                              className="secondary-button"
                              disabled={
                                !listeningEvents.length && !engagementEvents.length
                              }
                              onClick={() => {
                                if (trackingKey) {
                                  clearListeningHistory(localStorage, trackingKey);
                                  clearListeningHistory(sessionStorage, trackingKey);
                                }
                                setListeningEvents([]);
                                resetLearning();
                                notify("Your local listening profile was cleared.");
                              }}
                            >
                              Clear data
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="settings-section-heading">
                        <h2>Keyboard</h2>
                        <p>Review and remap every command in Volta.</p>
                      </div>
                      <div className="settings-rows">
                        <div className="setting-row setting-action-row">
                          <span>
                            <b>Keyboard shortcuts</b>
                            <small>Search, review, and customize every command</small>
                          </span>
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setShortcutQuery("");
                              setRecordingShortcut(null);
                              setShortcutsOpen(true);
                            }}
                          >
                            Open shortcuts
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="settings-section-heading">
                        <h2>{sourceMode === "local" ? "Session" : "Navidrome"}</h2>
                        <p>The library Volta is currently connected to.</p>
                      </div>
                      <div className="settings-rows">
                        <div className="setting-row settings-account-row">
                          <span className="settings-account-identity">
                            <CircleUserRound size={32} />
                            <div>
                              <b>{account.username}</b>
                              <span>
                                {sourceMode === "local"
                                  ? "This device"
                                  : account.server}
                              </span>
                            </div>
                          </span>
                          <button className="secondary-button" onClick={disconnect}>
                            Disconnect
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
              {route.page === "home" && (
                <>
                  <section className="music-section">
                    <div className="section-heading">
                      <h2>From Your Collection</h2>
                      <span>Rediscover something good.</span>
                    </div>
                    {albumGrid(visibleAlbums, true, true)}
                  </section>
                  {data.recentlyPlayed.length > 0 && (
                    <section className="music-section recently-played-section">
                      <div className="section-heading">
                        <button onClick={() => navigate({ page: "played" })}>
                          <h2>Recently Played</h2>
                          <ChevronRight size={18} />
                        </button>
                        <span>Your latest listens.</span>
                      </div>
                      {albumGrid(recentlyPlayedAlbums, true)}
                    </section>
                  )}
                  {recommendedAlbums.length > 0 && (
                    <section
                      className="music-section recommendations-section"
                      data-recommendations="personalized"
                    >
                      <div className="section-heading">
                        <h2>Made for you</h2>
                        <span>Based on your listening, with room to wander.</span>
                      </div>
                      {albumGrid(recommendedAlbums, true)}
                    </section>
                  )}
                  <section className="music-section">
                    <div className="section-heading">
                      <button onClick={() => navigate({ page: "recent" })}>
                        <h2>Recently Added</h2>
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    {albumGrid(
                      filteredRecentAlbums,
                      true,
                    )}
                  </section>
                  {data.frequent.length > 0 && (
                    <section className="music-section">
                      <div className="section-heading">
                        <h2>Heavy Rotation</h2>
                      </div>
                      {albumGrid(
                      filteredFrequentAlbums,
                        true,
                      )}
                    </section>
                  )}
                  {!data.albums.length && !data.recent.length && (
                    <EmptyState
                      title="Your music belongs here"
                      message={
                        sourceMode === "local"
                          ? "Choose a folder with music files before opening this library."
                          : "Add music to Navidrome, then refresh your library."
                      }
                    />
                  )}
                </>
              )}
              {(route.page === "albums" || route.page === "recent") &&
                (visibleAlbums.length ? (
                  albumGrid(visibleAlbums)
                ) : (
                  <EmptyState
                    title="No albums found"
                    message={
                      filter
                        ? "Try a different filter."
                        : sourceMode === "local"
                          ? "Albums appear here when Volta finds music in your folder."
                          : "Albums appear here after Navidrome scans your music."
                    }
                  />
                ))}
              {route.page === "played" &&
                (visibleAlbums.length ? (
                  albumGrid(visibleAlbums)
                ) : (
                  <EmptyState
                    title="No recently played albums"
                    message={
                      sourceMode === "local"
                        ? "Recently played albums are available for Navidrome libraries."
                        : "Play music in Navidrome to build your recent history."
                    }
                  />
                ))}
              {route.page === "artists" &&
                (visibleArtists.length ? (
                  <div
                    className="artist-grid"
                    onPointerEnter={warmArtistArtwork}
                    onFocus={warmArtistArtwork}
                  >
                    {renderedArtists.map((artist) => (
                      <button
                        className="artist-card"
                        data-search-result="true"
                        key={artist.id}
                        onClick={() =>
                          navigate({
                            page: "artist",
                            id: artist.id,
                            title: artist.name,
                          })
                        }
                      >
                        <Artwork
                          client={client}
                          id={artist.coverArt}
                          imageUrl={artist.artistImageUrl || artist.localArtworkUrl}
                          size={300}
                        />
                        <b>{artist.name}</b>
                        <span>{artist.albumCount || 0} albums</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No artists found"
                    message={
                      filter
                        ? "Try a different filter."
                        : sourceMode === "local"
                          ? "Artists appear here when Volta finds music in your folder."
                          : "Artists appear here after Navidrome scans your music."
                    }
                  />
                ))}
              {(route.page === "songs" || route.page === "favorites") &&
                (visibleSongs.length ? (
                  songTable(renderedSongs)
                ) : (
                  <EmptyState
                    title={
                      route.page === "favorites"
                        ? "Your favorites, together"
                        : "No songs found"
                    }
                    message={
                      route.page === "favorites"
                        ? "Favorite a song from its menu to find it here."
                        : "Try another filter or refresh your library."
                    }
                  />
                ))}
              {route.page === "playlists" &&
                (data.playlists.length ? (
                  <div className="album-grid">
                    {data.playlists
                      .filter((playlist) =>
                        playlist.name
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((playlist) => (
                        <article className="album-card" key={playlist.id}>
                          <button
                            className="artwork-link"
                            onClick={() =>
                              navigate({
                                page: "playlist",
                                id: playlist.id,
                                title: playlist.name,
                              })
                            }
                          >
                            <Artwork client={client} id={playlist.coverArt} eager />
                            <span className="playlist-placeholder-label">
                              {!playlist.coverArt && <ListMusic size={54} />}
                            </span>
                          </button>
                          <button
                            className="album-caption"
                            onClick={() =>
                              navigate({
                                page: "playlist",
                                id: playlist.id,
                                title: playlist.name,
                              })
                            }
                          >
                            <span>{playlist.name}</span>
                            <small>{playlist.songCount || 0} songs</small>
                          </button>
                        </article>
                      ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No playlists yet"
                    message={
                      sourceMode === "local"
                        ? "Local playlists are not available yet."
                        : "Your Navidrome playlists will appear here."
                    }
                  />
                ))}
              {(route.page === "album" || route.page === "playlist") && (
                <>
                  <div className="collection-header">
                    <Artwork
                      client={client}
                      id={data.album?.coverArt || data.playlist?.coverArt}
                      imageUrl={data.album?.localArtworkUrl}
                      size={700}
                      eager
                    />
                    <div className="collection-info">
                      <p className="collection-kind">
                        {route.page === "playlist" ? "Playlist" : "Album"}
                      </p>
                      <h1>{title}</h1>
                      {data.album && (
                        <button
                          className="artist-link"
                          disabled={!data.album.artistId}
                          onClick={() =>
                            data.album?.artistId &&
                            navigate({
                              page: "artist",
                              id: data.album.artistId,
                              title: data.album.artist,
                            })
                          }
                        >
                          {data.album.artist || "Unknown artist"}
                        </button>
                      )}
                      {data.playlist?.comment && (
                        <p className="collection-comment">
                          {data.playlist.comment}
                        </p>
                      )}
                      <p className="collection-meta">
                        {data.album?.genre || data.playlist?.owner || ""}
                        {data.album?.year ? " · " + data.album.year : ""}
                      </p>
                      <div className="collection-actions">
                        <button
                          data-search-result="true"
                          onClick={() => player.playSongs(data.songs)}
                          disabled={!data.songs.length}
                        >
                          <Play size={15} fill="currentColor" />
                          Play
                        </button>
                        <button
                          data-search-result="true"
                          onClick={() =>
                            player.playSongs(shuffleSongs(data.songs))
                          }
                          disabled={!data.songs.length}
                        >
                          <Shuffle size={16} />
                          Shuffle
                        </button>
                        {route.page === "playlist" && canEditPlaylist && (
                          <button
                            className="secondary-button"
                            onClick={() =>
                              data.playlist &&
                              setPlaylistDraft({
                                playlist: data.playlist,
                                name: data.playlist.name,
                              })
                            }
                          >
                            Edit Playlist
                          </button>
                        )}
                        {route.page === "playlist" && canEditPlaylist && (
                          <button
                            className="secondary-button"
                            onClick={() => data.playlist && setPlaylistToDelete(data.playlist)}
                          >
                            Delete Playlist
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {songTable(
                    visibleSongs,
                    true,
                    true,
                    route.page === "playlist" ? data.playlist : undefined,
                  )}
                  <p className="collection-footer">
                    {data.songs.length} songs,{" "}
                    {Math.round(
                      data.songs.reduce(
                        (sum, song) => sum + (song.duration || 0),
                        0,
                      ) / 60,
                    )}{" "}
                    minutes
                  </p>
                  {route.page === "album" && data.similarAlbums.length > 0 && (
                    <section className="music-section related-section">
                      <div className="section-heading">
                        <h2>You might also like</h2>
                        <span>Albums</span>
                      </div>
                      {albumGrid(data.similarAlbums, true)}
                    </section>
                  )}
                </>
              )}
              {route.page === "artist" && (
                <>
                  <div className="artist-header">
                    <Artwork
                      client={client}
                      id={data.artist?.coverArt}
                      imageUrl={data.artist?.artistImageUrl || data.artist?.localArtworkUrl}
                      size={400}
                    />
                    <div>
                      <p className="collection-kind">Artist</p>
                      <h1>{data.artist?.name}</h1>
                      <p>{data.albums.length} albums in your library</p>
                    </div>
                  </div>
                  <section className="music-section">
                    <div className="section-heading">
                      <h2>Albums</h2>
                    </div>
                    {albumGrid(visibleAlbums)}
                  </section>
                  {data.similarArtists.length > 0 && (
                    <section className="music-section related-section">
                      <div className="section-heading">
                        <h2>You might also like</h2>
                        <span>Artists</span>
                      </div>
                      {artistGrid(data.similarArtists)}
                    </section>
                  )}
                </>
              )}
              {route.page === "search" &&
                (!debouncedQuery ? (
                  <>
                    {searchHistory.length > 0 && (
                      <section className="search-history" aria-label="Recent searches">
                        <div className="section-heading">
                          <h2>Recent searches</h2>
                          <button onClick={() => setSearchHistory([])}>
                            Clear
                          </button>
                        </div>
                        <div className="search-history-list">
                          {searchHistory.map((term) => (
                            <button
                              key={term}
                              onClick={() => {
                                setQuery(term);
                                showSearch();
                                searchRef.current?.focus();
                              }}
                            >
                              <Search size={14} />
                              <span>{term}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                    {genreBrowser(null, false)}
                  </>
                ) : !data.albums.length &&
                  !data.songs.length &&
                  !data.artists.length ? (
                  <EmptyState
                    title={
                      query.trim() !== debouncedQuery
                        ? "Searching…"
                        : "No results"
                    }
                    message={
                      query.trim() !== debouncedQuery
                        ? "Finding matches in your library."
                        : "Try another artist, album, or song."
                    }
                  />
                ) : (
                  <>
                    <div className="search-summary">
                      {query.trim() !== debouncedQuery
                        ? "Searching your library…"
                        : sourceMode === "local"
                          ? "Results from this device"
                          : "Results from your Navidrome library"}
                    </div>
                    {data.artists.length > 0 && (
                      <section className="music-section">
                        <div className="section-heading">
                          <h2>Artists</h2>
                        </div>
                        <div className="search-artists">
                          {data.artists.map((artist) => (
            <button
              key={artist.id}
              data-search-result="true"
              onClick={() =>
                                navigate({
                                  page: "artist",
                                  id: artist.id,
                                  title: artist.name,
                                })
                              }
                            >
                              <Artwork
                                client={client}
                                id={artist.coverArt}
                                imageUrl={artist.artistImageUrl || artist.localArtworkUrl}
                                size={160}
                              />
                              <span>
                                {artist.name}
                                <small>Artist</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                    {data.albums.length > 0 && (
                      <section className="music-section">
                        <div className="section-heading">
                          <h2>Albums</h2>
                        </div>
                        {albumGrid(data.albums, true, false, true)}
                      </section>
                    )}
                    {data.songs.length > 0 && (
                      <section className="music-section">
                        <div className="section-heading">
                          <h2>Songs</h2>
                        </div>
                        {songTable(data.songs, false, true)}
                      </section>
                    )}
                  </>
                ))}
              {route.page === "genre" && genreBrowser(route.id || null, true)}
              <InfiniteScrollSentinel
                enabled={canLoadMore}
                loading={loadingMore}
                onLoad={loadMore}
              />
            </>
          )}
        </main>
        {panel && (
          <Inspector
            key={panel}
            panel={panel}
            client={client}
            player={player}
            onClose={() => setPanel(null)}
            externalLyricsEnabled={externalLyricsEnabled}
          />
        )}
        <PlaybackDock
          client={client}
          player={player}
          panel={panel}
          onPanel={(value) => setPanel((old) => (old === value ? null : value))}
          onExpand={openFullPlayer}
          infinitePlayEnabled={infinitePlayEnabled}
          onToggleInfinitePlay={toggleInfinitePlay}
          infinitePlayBusy={infinitePlayBusy}
          onFavorite={favorite}
          favorite={player.currentSong ? isFavorite(player.currentSong) : false}
        />
      </div>
      {fullPlayer && (
        <FullPlayer
          client={client}
          player={player}
          onClose={closeFullPlayer}
          onArtist={(artistId, artistName) => {
            setFullPlayer(false);
            navigate({ page: "artist", id: artistId, title: artistName });
          }}
          onFavorite={favorite}
          favorite={player.currentSong ? isFavorite(player.currentSong) : false}
          externalLyricsEnabled={externalLyricsEnabled}
        />
      )}
      <ContextMenu
        point={
          contextTarget
            ? { x: contextTarget.x, y: contextTarget.y }
            : null
        }
        items={contextItems}
        label={contextTarget?.type === "album" ? "Album actions" : "Song actions"}
        onClose={closeContextMenu}
      />
      <Modal
        open={Boolean(playlistDraft)}
        onClose={() => !playlistMutationBusy && setPlaylistDraft(null)}
        title={playlistDraft?.playlist ? "Edit Playlist" : "New Playlist"}
      >
        {playlistDraft && (
          <form
            className="playlist-form"
            onSubmit={(event) => {
              event.preventDefault();
              void savePlaylist();
            }}
          >
            <label>
              Playlist name
              <input
                aria-label="Playlist name"
                autoFocus
                value={playlistDraft.name}
                onChange={(event) =>
                  setPlaylistDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </label>
            {playlistDraft.song && (
              <p>Adds “{playlistDraft.song.title}” to this playlist.</p>
            )}
            <div className="playlist-form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={playlistMutationBusy}
                onClick={() => setPlaylistDraft(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={playlistMutationBusy}>
                {playlistMutationBusy
                  ? "Saving…"
                  : playlistDraft.playlist
                    ? "Save Changes"
                    : "Create Playlist"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(playlistPickerSong)}
        onClose={() => !playlistMutationBusy && setPlaylistPickerSong(null)}
        title="Add to Playlist"
      >
        {playlistPickerSong && (
          <div className="playlist-picker">
            <p>Add “{playlistPickerSong.title}” to:</p>
            {sidebarPlaylists.length ? (
              <div className="playlist-picker-list">
                {sidebarPlaylists.map((playlist) => (
                  <button
                    className="secondary-button"
                    key={playlist.id}
                    disabled={playlistMutationBusy || playlist.readonly}
                    onClick={() => void addSongToPlaylist(playlist, playlistPickerSong)}
                  >
                    <ListMusic size={16} />
                    {playlist.name}
                  </button>
                ))}
              </div>
            ) : (
              <p>You do not have any editable playlists yet.</p>
            )}
            <button
              className="primary-button"
              disabled={playlistMutationBusy}
              onClick={() => {
                setPlaylistDraft({ name: "", song: playlistPickerSong });
                setPlaylistPickerSong(null);
              }}
            >
              <ListPlus size={16} />
              New Playlist
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(playlistToDelete)}
        onClose={() => !playlistMutationBusy && setPlaylistToDelete(null)}
        title="Delete Playlist"
      >
        {playlistToDelete && (
          <div className="playlist-form">
            <p>
              Delete “{playlistToDelete.name}”? This only removes the playlist,
              not the music in it.
            </p>
            <div className="playlist-form-actions">
              <button
                className="secondary-button"
                disabled={playlistMutationBusy}
                onClick={() => setPlaylistToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={playlistMutationBusy}
                onClick={() => void deletePlaylist()}
              >
                {playlistMutationBusy ? "Deleting…" : "Delete Playlist"}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(detailsSong)}
        onClose={() => setDetailsSong(null)}
        title="Song details"
        className="media-details-dialog"
      >
        {detailsSong && (
          <div className="media-details">
            <Artwork
              client={client}
              id={detailsSong.coverArt}
              imageUrl={detailsSong.localArtworkUrl}
              size={420}
              eager
            />
            <div className="media-details-copy">
              <h3>{detailsSong.title}</h3>
              <p>{detailsSong.artist || "Unknown artist"}</p>
              {detailsSong.album && <small>{detailsSong.album}</small>}
              <dl>
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(detailsSong.duration)}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>
                    {isLossless(detailsSong)
                      ? "Lossless"
                      : detailsSong.suffix?.toUpperCase() || "Unknown"}
                  </dd>
                </div>
                {detailsSong.year && (
                  <div>
                    <dt>Year</dt>
                    <dd>{detailsSong.year}</dd>
                  </div>
                )}
              </dl>
              <div className="media-details-actions">
                {detailsSong.albumId && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setDetailsSong(null);
                      navigate({
                        page: "album",
                        id: detailsSong.albumId,
                        title: detailsSong.album,
                      });
                    }}
                  >
                    <Disc3 size={15} />
                    Go to Album
                  </button>
                )}
                {detailsSong.artistId && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setDetailsSong(null);
                      navigate({
                        page: "artist",
                        id: detailsSong.artistId,
                        title: detailsSong.artist,
                      });
                    }}
                  >
                    <UserRound size={15} />
                    Go to Artist
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(detailsAlbum)}
        onClose={() => setDetailsAlbum(null)}
        title="Album details"
        className="media-details-dialog"
      >
        {detailsAlbum && (
          <div className="media-details">
            <Artwork
              client={client}
              id={detailsAlbum.coverArt}
              imageUrl={detailsAlbum.localArtworkUrl}
              size={420}
              eager
            />
            <div className="media-details-copy">
              <h3>{albumName(detailsAlbum)}</h3>
              <p>{detailsAlbum.artist || "Unknown artist"}</p>
              <dl>
                <div>
                  <dt>Songs</dt>
                  <dd>{detailsAlbum.songCount ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(detailsAlbum.duration)}</dd>
                </div>
                {detailsAlbum.year && (
                  <div>
                    <dt>Year</dt>
                    <dd>{detailsAlbum.year}</dd>
                  </div>
                )}
                {detailsAlbum.genre && (
                  <div>
                    <dt>Genre</dt>
                    <dd>{detailsAlbum.genre}</dd>
                  </div>
                )}
              </dl>
              <div className="media-details-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setDetailsAlbum(null);
                    navigate({
                      page: "album",
                      id: detailsAlbum.id,
                      title: albumName(detailsAlbum),
                    });
                  }}
                >
                  <Disc3 size={15} />
                  Open Album
                </button>
                {detailsAlbum.artistId && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setDetailsAlbum(null);
                      navigate({
                        page: "artist",
                        id: detailsAlbum.artistId,
                        title: detailsAlbum.artist,
                      });
                    }}
                  >
                    <UserRound size={15} />
                    Go to Artist
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={listeningHistoryOpen}
        onClose={() => setListeningHistoryOpen(false)}
        title="Listening history"
        className="listening-history-dialog"
      >
        <ListeningHistoryView
          events={listeningEvents}
          profile={listeningProfile}
          engagementEvents={engagementEvents}
          engagementProfile={engagementProfile}
          rankerModel={rankerModel}
          enabled={listeningHistoryEnabled}
          persistent={listeningHistoryPersistent}
          onPersistenceChange={changeListeningHistoryPersistence}
          onResetLearning={resetLearning}
        />
      </Modal>
      <Modal
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
          setRecordingShortcut(null);
        }}
        title="Keyboard shortcuts"
        className="keyboard-shortcuts-dialog"
      >
        <div className="shortcut-manager">
          <div className="shortcut-manager-toolbar">
            <label className="shortcut-search">
              <Search size={15} />
              <input
                autoFocus
                aria-label="Search keyboard shortcuts"
                placeholder="Search shortcuts"
                value={shortcutQuery}
                onChange={(event) => setShortcutQuery(event.target.value)}
              />
              {shortcutQuery && (
                <button
                  type="button"
                  className="shortcut-search-clear"
                  aria-label="Clear shortcut search"
                  onClick={() => setShortcutQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <button className="secondary-button" onClick={resetShortcuts}>
              Reset defaults
            </button>
          </div>
          <p className="shortcut-manager-summary">
            {filteredShortcuts.length} of {SHORTCUT_DEFINITIONS.length} shortcuts
            {recordingShortcut ? " · Press a key combination to assign it" : ""}
          </p>
          <div className="shortcut-list" role="list" aria-label="Keyboard shortcuts">
            {filteredShortcuts.length ? (
              filteredShortcuts.map((definition, index) => {
                const showCategory =
                  index === 0 ||
                  definition.category !== filteredShortcuts[index - 1].category;
                const isRecording = recordingShortcut === definition.id;
                const bindingLabel = formatShortcut(shortcuts[definition.id]);
                return (
                  <div className="shortcut-group" key={definition.id}>
                    {showCategory && <h3>{definition.category}</h3>}
                    <div className="shortcut-row" role="listitem">
                      <span className="shortcut-copy">
                        <b>{definition.label}</b>
                        <small>{definition.description}</small>
                      </span>
                      <button
                        type="button"
                        className={
                          "shortcut-binding" + (isRecording ? " recording" : "")
                        }
                        aria-label={`${definition.label}: ${
                          isRecording ? "Press a key combination" : bindingLabel
                        }`}
                        onClick={() => setRecordingShortcut(definition.id)}
                        onKeyDown={(event) =>
                          isRecording && recordShortcut(definition.id, event)
                        }
                      >
                        {isRecording ? "Press keys…" : bindingLabel}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="shortcut-empty">
                <Search size={22} />
                <p>No shortcuts match “{shortcutQuery}”.</p>
              </div>
            )}
          </div>
          <p className="setting-description">
            Select a binding, then press the new key combination. On this device,
            the modifier key is {modifierLabel}. Shortcuts pause while you type
            in a field.
          </p>
        </div>
      </Modal>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <IconButton label="Dismiss message" onClick={() => setNotice("")}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      </div>
      {scalePreviewOverlay}
    </ArtworkMotionProvider>
  );
}
