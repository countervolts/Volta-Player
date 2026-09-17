import { playbackRecommendationReward } from "./lib/learned-ranker";
import { observeRecommendationVisibility } from "./lib/recommendation-visibility";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type FormEvent,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownWideNarrow,
  Ban,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Disc3,
  Eye,
  EyeOff,
  FolderOpen,
  Grid2X2,
  Github,
  Info,
  ListEnd,
  ListPlus,
  House,
  ListMusic,
  LoaderCircle,
  Mic2,
  Music2,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Play,
  RefreshCw,
  Copy,
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
  diagnoseConnection,
  duration,
  isConnectionFailure,
  isLocalSong,
  serverCandidates,
  shuffleSongs,
  type AlbumRecord,
  type Artist,
  type ConnectionIssue,
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
import {
  usePlayer,
  type PlaybackSession,
  type VolumePreference,
} from "./lib/use-player";
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
  prefetchArtwork,
  TrackTable,
  type ContextMenuItem,
} from "./components";
import { Inspector, PlaybackDock } from "./player-ui";
import { SearchGenres } from "./search-genres";
import {
  resolveShareUrl,
  type ShareTarget,
} from "./lib/share-links";
import {
  favoriteAlbumIdsFromSongs,
  mergeRecommendationCandidates,
  rankAlbumRecommendations,
  songAlbumCandidates,
  topArtistSeeds,
} from "./lib/recommendations";
import {
  infinitePlayAlbumTarget,
  interleaveAlbumSongs,
  loadRankedAlbumSongs,
  rankInfinitePlayAlbums,
} from "./lib/infinite-play";
import {
  DEFAULT_RECOMMENDATION_TUNING,
  normalizeRecommendationTuning,
  readRecommendationTuning,
  writeRecommendationTuning,
  type RecommendationTuning,
} from "./lib/recommendation-tuning";
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
import { onBetaChannel } from "./lib/beta-channel";
import {
  EMPTY,
  pageHasMore,
  SEARCH_ALBUM_PAGE_SIZE,
  SEARCH_ARTIST_PAGE_SIZE,
  SEARCH_SONG_PAGE_SIZE,
  PLAYLIST_DESCRIPTION_MAX_LENGTH,
  type ContextTarget,
  type Page,
  type PageData,
  type PlaylistDraft,
  type Route,
  type SettingsFocus,
} from "./app/app-model";
import { Connect } from "./app/connect";
import { FolderView } from "./app/folder-view";
import { LibrarySidebar } from "./app/library-sidebar";
import { SettingsView } from "./app/settings-view";
import { PerformanceOverlay } from "./app/performance-overlay";
import { AppDialogs } from "./app/app-dialogs";
import {
  accountKey,
  clampInterfaceScale,
  CROSSFADE_KEY,
  EXTERNAL_LYRICS_KEY,
  LYRICS_BLUR_KEY,
  FRAME_MONITOR_KEY,
  INFINITE_PLAY_COUNT_KEY,
  INFINITE_PLAY_ENABLED_KEY,
  INFINITE_PLAY_MODE_KEY,
  INTERFACE_SCALE_KEY,
  LISTENING_HISTORY_ENABLED_KEY,
  LISTENING_HISTORY_PERSIST_KEY,
  libraryPathKey,
  LOCAL_ALBUM_FAVORITES_KEY,
  LOCAL_ARTIST_FAVORITES_KEY,
  LOCAL_FAVORITES_KEY,
  LOCAL_SOURCE_MODE_KEY,
  localLibraryPathKey,
  localPlaybackKey,
  localVolumeKey,
  LOGIN_DRAFT_KEY,
  lastPlayedSongKey,
  NORMALIZATION_KEY,
  pinKey,
  pinsStorageKey,
  readTransitionMode,
  TRANSITION_MODE_KEY,
  VOLUME_SCROLL_STEP_KEY,
  VOLUME_SHIFT_SCROLL_STEP_KEY,
  type TransitionMode,
  readAccounts,
  readInterfaceScale,
  readLocalFavoriteSet,
  readLocalFavorites,
  readLoginDraft,
  readPins,
  readRememberedCredentials,
  readShareProvider,
  readSessionCredentials,
  REMEMBERED_CREDENTIALS_KEY,
  REWARD_WINDOW_MS,
  safeRead,
  safeRemove,
  safeWrite,
  SEARCH_HISTORY_KEY,
  SHARE_PROVIDER_KEY,
  SESSION_CREDENTIALS_KEY,
  volumeKey,
  writeAccounts,
  writeLocalFavoriteSet,
  type InfinitePlayMode,
  type LoginDraft,
  type Pin as LibraryPin,
  type PinKind,
  type SavedAccount,
  type ShareProvider,
} from "./app/app-storage";

const StatsView = lazy(() =>
  import("./app/stats-view").then(({ StatsView: View }) => ({ default: View })),
);
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
  recentlyPlayedSongs: Array.isArray(value.recentlyPlayedSongs)
    ? value.recentlyPlayedSongs
    : [],
  artistSongs: Array.isArray(value.artistSongs) ? value.artistSongs : [],
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
  data.artistSongs.slice(0, 160).forEach((song) => {
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
  folders: "Folders",
  favorites: "Favorites",
  playlists: "Playlists",
  search: "Search",
  genre: "Genre",
  album: "Album",
  artist: "Artist",
  playlist: "Playlist",
  stats: "Stats",
  settings: "Settings",
};
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
/**
 * Most-recent-first track ids from the local listening profile. Navidrome does
 * not expose a "recently played songs" endpoint, so Volta's own on-device
 * history is the source. Ids are deduplicated and capped.
 */
const recentlyPlayedSongIds = (
  events: ListeningEvent[],
  limit = 60,
): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event.songId || seen.has(event.songId)) continue;
    seen.add(event.songId);
    ids.push(event.songId);
    if (ids.length >= limit) break;
  }
  return ids;
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
const DEFAULT_VOLUME = 0.8;
const readStoredVolume = (key: string): VolumePreference | null => {
  const raw = safeRead(localStorage, key);
  if (!raw) return null;
  const legacyVolume = Number(raw);
  if (Number.isFinite(legacyVolume) && legacyVolume >= 0 && legacyVolume <= 1) {
    return {
      volume: legacyVolume,
      muted: legacyVolume === 0,
      previousVolume: legacyVolume || DEFAULT_VOLUME,
    };
  }
  try {
    const value = JSON.parse(raw) as Partial<VolumePreference>;
    const volume = Number(value.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) return null;
    const previousVolume = Number(value.previousVolume);
    return {
      volume,
      muted: Boolean(value.muted) || volume === 0,
      previousVolume:
        Number.isFinite(previousVolume) && previousVolume > 0 && previousVolume <= 1
          ? previousVolume
          : volume || DEFAULT_VOLUME,
    };
  } catch {
    return null;
  }
};
const readVolume = (server: string, username: string) =>
  readStoredVolume(volumeKey(server, username));
const readLocalVolume = (directoryName: string) =>
  readStoredVolume(localVolumeKey(directoryName));
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
  const params = new URLSearchParams();
  if (route.page === "search" && query.trim())
    params.set("q", query.trim());
  if (route.page === "settings" && route.focus)
    params.set("focus", route.focus);
  const search = params.toString() ? `?${params}` : "";
  return `/${segments.join("/")}${search}`;
};
const fullscreenPath = (number: string) =>
  number ? `/${number}/player` : "/player";
const settingsFocusFromUrl = (url: URL): SettingsFocus | undefined => {
  const focus = url.searchParams.get("focus");
  return focus === "external-lyrics" ||
    focus === "local-data" ||
    focus === "recommendation-tuning"
    ? focus
    : undefined;
};
const readBrowserRoute = (
  number: string,
): { route: Route; query: string; fullscreen?: boolean } => {
  if (window.location.pathname === fullscreenPath(number))
    return { route: { page: "home" }, query: "", fullscreen: true };
  const url = new URL(window.location.href);
  const focus = settingsFocusFromUrl(url);
  if (!number)
    return {
      route: focus ? { page: "settings", focus } : { page: "home" },
      query: "",
    };
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== number || !segments[1])
    return {
      route: focus ? { page: "settings", focus } : { page: "home" },
      query: "",
    };
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
    route: { page, id, ...(page === "settings" && focus ? { focus } : {}) },
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

const sortArtistSongsByPopularity = (songs: Song[]) => {
  // Search results are the fallback order for servers that do not expose
  // playCount. When they do, put the most-played tracks first while keeping
  // the original order for ties.
  if (!songs.some((song) => Number.isFinite(song.playCount))) return songs;
  return songs
    .map((song, index) => ({ song, index }))
    .sort(
      (left, right) =>
        (right.song.playCount || 0) - (left.song.playCount || 0) ||
        left.index - right.index,
    )
    .map(({ song }) => song);
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
    case "folders":
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
        artistSongs: sortArtistSongsByPopularity(Array.from(
          new Map(
            (artist?.album || [])
              .flatMap((album) => album.song || [])
              .map((song) => [song.id, song]),
          ).values(),
        )),
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
    case "stats":
      return EMPTY;
    case "played":
    case "playlists":
      return EMPTY;
  }
  return EMPTY;
};

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
  const [connectionDiagnosis, setConnectionDiagnosis] =
    useState<ConnectionIssue | null>(null);
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
  const [recommendationTuning, setRecommendationTuning] =
    useState<RecommendationTuning>(() => readRecommendationTuning(localStorage));
  const updateRecommendationTuning = useCallback(
    (patch: Partial<RecommendationTuning>) => {
      setRecommendationTuning((current) =>
        writeRecommendationTuning(
          localStorage,
          normalizeRecommendationTuning({ ...current, ...patch }),
        ),
      );
    },
    [],
  );
  const resetRecommendationTuning = useCallback(() => {
    // Persist the defaults explicitly rather than deleting the key: storage
    // should always mirror the tuning the ranker is actually using.
    setRecommendationTuning(
      writeRecommendationTuning(localStorage, {
        ...DEFAULT_RECOMMENDATION_TUNING,
      }),
    );
    notify("Recommendation engine restored to defaults.");
  }, [notify]);
  const [engineOpen, setEngineOpen] = useState(false);
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
  // Last non-empty recommendation candidate pool. Settings keeps this so the
  // tuning preview still has material after the Home route tears its data down.
  // State, not a ref: the preview memo must recompute when this arrives.
  const [homeRecommendationCandidates, setHomeRecommendationCandidates] =
    useState<AlbumRecord[]>([]);
  // The broader retrieval pool from the last Home load. Kept separately from
  // the small shelf candidate list because discovery ranks against the whole
  // library, not just the albums the server put on the home page.
  const [homeRecommendationPool, setHomeRecommendationPool] = useState<
    AlbumRecord[]
  >([]);
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
      const reward = playbackRecommendationReward(event);
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
  // Songs and artists are ordered on the client; the album list uses the
  // server's own sort types because they change which records are returned.
  const [songSort, setSongSort] = useState("default");
  const [artistSort, setArtistSort] = useState("name");
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
  const [albumFavorites, setAlbumFavorites] = useState<Record<string, boolean>>(
    () => readLocalFavoriteSet(LOCAL_ALBUM_FAVORITES_KEY, "local-album:"),
  );
  const [artistFavorites, setArtistFavorites] = useState<Record<string, boolean>>(
    () => readLocalFavoriteSet(LOCAL_ARTIST_FAVORITES_KEY, "local-artist:"),
  );
  const [albumFavoritePending, setAlbumFavoritePending] = useState<Set<string>>(
    new Set(),
  );
  const [artistFavoritePending, setArtistFavoritePending] = useState<Set<string>>(
    new Set(),
  );
  const [favoritesTab, setFavoritesTab] = useState<"songs" | "albums" | "artists">(
    "songs",
  );
  const [expandedArtistSongsId, setExpandedArtistSongsId] = useState<string | null>(
    null,
  );
  const [searchTab, setSearchTab] = useState<
    "all" | "artists" | "albums" | "songs"
  >("all");
  const [playedTab, setPlayedTab] = useState<"albums" | "songs">("albums");
  // Song multi-select. Index-based so duplicate tracks in a playlist stay
  // distinct, and reset whenever the visible list changes.
  const [selecting, setSelecting] = useState(false);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(
    new Set(),
  );
  const selectionAnchor = useRef<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const playlistSongsRef = useRef<Song[]>([]);
  const [pins, setPins] = useState<LibraryPin[]>([]);
  const pinArtworkHydration = useRef(new Set<string>());
  const [accounts, setAccounts] = useState<SavedAccount[]>(readAccounts);
  const rememberAccount = useCallback(
    (account: SavedAccount) => {
      setAccounts((current) => {
        const next = [
          account,
          ...current.filter(
            (item) => accountKey(item) !== accountKey(account),
          ),
        ].slice(0, 12);
        writeAccounts(next);
        return next;
      });
    },
    [],
  );
  const forgetAccount = useCallback(
    (account: SavedAccount) => {
      setAccounts((current) => {
        const next = current.filter(
          (item) => accountKey(item) !== accountKey(account),
        );
        writeAccounts(next);
        return next;
      });
      notify(`Forgot ${account.username} on ${account.server}.`);
    },
    [notify],
  );
  const pinStorageKey = account.server
    ? pinsStorageKey(account.server, account.username)
    : "";
  useEffect(() => {
    if (!pinStorageKey) {
      setPins([]);
      return;
    }
    setPins(readPins(pinStorageKey));
  }, [pinStorageKey]);
  useEffect(() => {
    if (!client || sourceMode !== "navidrome" || !pinStorageKey) return;
    const missing = pins.filter(
      (pin) =>
        !pin.coverArt &&
        !pin.imageUrl &&
        !pinArtworkHydration.current.has(pinKey(pin)),
    );
    if (!missing.length) return;
    missing.forEach((pin) => pinArtworkHydration.current.add(pinKey(pin)));
    let cancelled = false;
    void Promise.all(
      missing.map(async (pin) => {
        try {
          if (pin.kind === "album") {
            const album = await client.album(pin.id);
            return [pinKey(pin), {
              coverArt: album.coverArt,
              imageUrl: album.localArtworkUrl,
            }] as const;
          }
          if (pin.kind === "artist") {
            const artist = await client.artist(pin.id);
            return [pinKey(pin), {
              coverArt: artist.coverArt,
              imageUrl: artist.artistImageUrl || artist.localArtworkUrl,
            }] as const;
          }
        } catch {
          // Keep the pin usable with its generic icon if artwork is unavailable.
        }
        return null;
      }),
    ).then((results) => {
      if (cancelled) return;
      const updates = new Map(
        results.filter(
          (
            result,
          ): result is readonly [
            string,
            { readonly coverArt: string | undefined; readonly imageUrl: string | undefined },
          ] => Boolean(result && (result[1].coverArt || result[1].imageUrl)),
        ),
      );
      if (!updates.size) return;
      setPins((current) => {
        let changed = false;
        const next = current.map((pin) => {
          const update = updates.get(pinKey(pin));
          if (!update || pin.coverArt || pin.imageUrl) return pin;
          changed = true;
          return { ...pin, ...update };
        });
        if (changed) safeWrite(localStorage, pinStorageKey, JSON.stringify(next));
        return changed ? next : current;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [client, pinStorageKey, pins, sourceMode]);
  const isPinned = useCallback(
    (kind: PinKind, id: string) =>
      pins.some((pin) => pin.kind === kind && pin.id === id),
    [pins],
  );
  const togglePin = useCallback(
    (pin: LibraryPin) => {
      if (!pinStorageKey) return;
      setPins((current) => {
        const exists = current.some(
          (item) => item.kind === pin.kind && item.id === pin.id,
        );
        const next = exists
          ? current.filter(
              (item) => !(item.kind === pin.kind && item.id === pin.id),
            )
          : [...current, pin];
        safeWrite(localStorage, pinStorageKey, JSON.stringify(next));
        notify(exists ? `Unpinned ${pin.name}.` : `Pinned ${pin.name}.`);
        return next;
      });
    },
    [notify, pinStorageKey],
  );
  const [panel, setPanel] = useState<"queue" | "lyrics" | null>(null);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(
    null,
  );
  const [pageContextPoint, setPageContextPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [detailsSong, setDetailsSong] = useState<Song | null>(null);
  const [detailsAlbum, setDetailsAlbum] = useState<AlbumRecord | null>(null);
  const [fullPlayer, setFullPlayer] = useState(false);
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft | null>(
    null,
  );
  const [playlistPickerSongs, setPlaylistPickerSongs] = useState<Song[] | null>(
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => safeRead(localStorage, "volta-sidebar-collapsed") === "true",
  );
  // Below 640px the sidebar is a drawer; above it, a collapsible icon rail.
  const [compactLayout, setCompactLayout] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(max-width: 640px)").matches),
  );
  const [theme, setTheme] = useState(
    () => safeRead(localStorage, "volta-theme") || "dark",
  );
  // "system" follows the OS light/dark setting and updates live.
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark",
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;
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
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(() => {
    const value = Number(safeRead(localStorage, CROSSFADE_KEY));
    return Number.isFinite(value) ? Math.min(12, Math.max(0, value)) : 0;
  });
  const [volumeScrollStep, setVolumeScrollStep] = useState(() => {
    const value = Number(safeRead(localStorage, VOLUME_SCROLL_STEP_KEY));
    return Number.isFinite(value) && value >= 1 && value <= 10
      ? Math.round(value)
      : 5;
  });
  const [volumeShiftScrollStep, setVolumeShiftScrollStep] = useState(() => {
    const value = Number(safeRead(localStorage, VOLUME_SHIFT_SCROLL_STEP_KEY));
    return Number.isFinite(value) && value >= 1 && value <= 10
      ? Math.round(value)
      : 10;
  });
  const [transitionMode, setTransitionMode] = useState<TransitionMode>(
    readTransitionMode,
  );
  const [normalization, setNormalization] = useState<"off" | "track" | "album">(
    () => {
      const value = safeRead(localStorage, NORMALIZATION_KEY);
      return value === "track" || value === "album" ? value : "off";
    },
  );
  const [externalLyricsEnabled, setExternalLyricsEnabled] = useState(
    () => safeRead(localStorage, EXTERNAL_LYRICS_KEY) === "true",
  );
  const [lyricsBlurEnabled, setLyricsBlurEnabled] = useState(
    () => safeRead(localStorage, LYRICS_BLUR_KEY) !== "false",
  );
  // Diagnostics are beta-only, so the setting is ignored on the stable channel
  // even if it was left switched on in a synced profile.
  const betaChannel = onBetaChannel();
  const [frameMonitor, setFrameMonitor] = useState(
    () => safeRead(localStorage, FRAME_MONITOR_KEY) === "true",
  );
  const [shareProvider, setShareProvider] = useState<ShareProvider>(
    readShareProvider,
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
  const copyShareLink = useCallback(
    async (target: ShareTarget) => {
      const providerName = shareProvider === "apple-music" ? "Apple Music" : "Spotify";
      notify(
        shareProvider === "apple-music"
          ? "Finding an Apple Music link…"
          : "Preparing a Spotify link…",
      );
      try {
        const link = await resolveShareUrl(shareProvider, target);
        await navigator.clipboard.writeText(link.url);
        notify(
          link.exact
            ? `${providerName} link copied.`
            : `${providerName} search link copied.`,
        );
      } catch {
        notify(`Could not copy the ${providerName} link.`);
      }
    },
    [notify, shareProvider],
  );
  const shareSong = useCallback(
    (song: Song) =>
      void copyShareLink({
        type: "song",
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
      }),
    [copyShareLink],
  );
  const shareAlbum = useCallback(
    (album: AlbumRecord) =>
      void copyShareLink({
        type: "album",
        title: albumName(album),
        artist: album.artist,
      }),
    [copyShareLink],
  );
  const shareArtist = useCallback(
    (artist: Artist) =>
      void copyShareLink({
        type: "artist",
        title: artist.name,
      }),
    [copyShareLink],
  );
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
    document.documentElement.dataset.theme = resolvedTheme;
    safeWrite(localStorage, "volta-theme", theme);
  }, [resolvedTheme, theme]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? "light" : "dark");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
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
      "volta-sidebar-collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 640px)");
    if (!media) return;
    const update = () => setCompactLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    safeWrite(localStorage, CROSSFADE_KEY, String(crossfadeSeconds));
    safeWrite(localStorage, TRANSITION_MODE_KEY, transitionMode);
    // AutoMix plans its own overlap, so the fixed crossfade is only armed in
    // Crossfade mode. Both remain mutually exclusive with the gapless handoff.
    player.setCrossfade(
      transitionMode === "crossfade"
        ? Math.max(1, crossfadeSeconds || 6)
        : 0,
    );
    player.setAutomix(transitionMode === "automix");
  }, [
    crossfadeSeconds,
    transitionMode,
    player.setCrossfade,
    player.setAutomix,
  ]);
  useEffect(() => {
    safeWrite(localStorage, NORMALIZATION_KEY, normalization);
    player.setNormalization(normalization);
  }, [normalization, player.setNormalization]);
  useEffect(() => {
    safeWrite(localStorage, VOLUME_SCROLL_STEP_KEY, String(volumeScrollStep));
  }, [volumeScrollStep]);
  useEffect(() => {
    safeWrite(
      localStorage,
      VOLUME_SHIFT_SCROLL_STEP_KEY,
      String(volumeShiftScrollStep),
    );
  }, [volumeShiftScrollStep]);
  useEffect(() => {
    safeWrite(
      localStorage,
      EXTERNAL_LYRICS_KEY,
      String(externalLyricsEnabled),
    );
  }, [externalLyricsEnabled]);
  useEffect(() => {
    safeWrite(localStorage, LYRICS_BLUR_KEY, String(lyricsBlurEnabled));
  }, [lyricsBlurEnabled]);
  useEffect(() => {
    safeWrite(localStorage, FRAME_MONITOR_KEY, String(frameMonitor));
  }, [frameMonitor]);
  useEffect(() => {
    safeWrite(localStorage, SHARE_PROVIDER_KEY, shareProvider);
  }, [shareProvider]);
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
    player.restoreVolume(
      readLocalVolume(libraryKey) ?? {
        volume: DEFAULT_VOLUME,
        muted: false,
        previousVolume: DEFAULT_VOLUME,
      },
    );
    const session = readLocalPlaybackSession(localMusic);
    if (session) player.restoreSession(session);
  }, [localMusic, player.restoreSession, player.restoreVolume, sourceMode]);
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
      JSON.stringify({
        volume: player.volume,
        muted: player.muted,
        previousVolume: player.previousVolume,
      }),
    );
  }, [
    localMusic?.directoryName,
    player.muted,
    player.previousVolume,
    player.volume,
    sourceMode,
  ]);
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
      JSON.stringify({
        volume: player.volume,
        muted: player.muted,
        previousVolume: player.previousVolume,
      }),
    );
  }, [
    account.server,
    account.username,
    client,
    player.muted,
    player.previousVolume,
    player.volume,
    sourceMode,
  ]);
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
    // A new query starts on the combined view again.
    setSearchTab("all");
  }, [debouncedQuery]);
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
    player.restoreVolume(
      readLocalVolume(localMusic.directoryName) ?? {
        volume: DEFAULT_VOLUME,
        muted: false,
        previousVolume: DEFAULT_VOLUME,
      },
    );
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
  }, [localClient, localMusic, player.restoreVolume, player.stop]);
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
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      // Song and album surfaces own their richer context menus and prevent the
      // native menu themselves. Leave form fields, links, and buttons alone so
      // browser text/link actions remain available where they matter.
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable=\"true\"]"))
        return;
      event.preventDefault();
      setContextTarget(null);
      setPageContextPoint({ x: event.clientX, y: event.clientY });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
  const openSongContextMenu = useCallback(
    (event: ReactMouseEvent, song: Song) => {
      event.preventDefault();
      setPageContextPoint(null);
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
      setPageContextPoint(null);
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
    setConnectionDiagnosis(null);
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
      // Keep this library available for one-click switching later.
      rememberAccount({
        server: service.server,
        username: service.username,
        auth: { salt: service.auth.salt, token: service.auth.token },
      });
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
      player.restoreVolume(
        readVolume(identity.server, identity.username) ?? {
          volume: DEFAULT_VOLUME,
          muted: false,
          previousVolume: DEFAULT_VOLUME,
        },
      );
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
      if (error instanceof TypeError) {
        // Distinguish a blocked origin from an unreachable host so the user
        // gets the fix that actually applies to their setup.
        const issue = await diagnoseConnection(credentials.server);
        setConnectionDiagnosis(issue);
        setConnectionError(
          issue === "mixed-content"
            ? "This page is HTTPS but your server address is HTTP, so the browser blocked the connection."
            : issue === "cors"
              ? "The server answered, but your browser blocked the response (CORS). Allow this site’s origin in Navidrome."
              : "Cannot reach Navidrome. Check the server address and that it is online.",
        );
      } else {
        setConnectionError(
          error instanceof Error
            ? error.message
            : "Connection failed. Check your server address and credentials.",
        );
      }
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
          const [albums, recent, recentlyPlayed, frequent, favoriteResults, pool] =
            await Promise.all([
              client.albums("random", 32, 0, controller.signal),
              client.albums("newest", 12, 0, controller.signal),
              client.albums("recent", 12, 0, controller.signal),
              client.albums("frequent", 12, 0, controller.signal),
              client.favorites(controller.signal).catch(() => ({
                song: [],
                album: [],
                artist: [],
              })),
              // The whole library for retrieval. Without it the ranker can
              // only reorder the ~60 albums the server chose to show, which is
              // why discovery had nothing genuinely new to offer. Paginated, so
              // a library larger than one page is not silently truncated.
              client
                .allAlbums({ signal: controller.signal })
                .catch(() => [] as AlbumRecord[]),
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
            recommendationPool: pool,
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
        case "played": {
          const albumList = await client.albums(
            "recent",
            60,
            0,
            controller.signal,
          );
          const played = recentlyPlayedSongIds(listeningEvents);
          const songs = played.length
            ? (
                await Promise.all(
                  played.map((id) =>
                    client.song(id, controller.signal).catch(() => null),
                  ),
                )
              ).filter((song): song is Song => Boolean(song))
            : [];
          return { ...EMPTY, albums: albumList, recentlyPlayedSongs: songs };
        }
        case "artists":
          return { ...EMPTY, artists: await client.artists(controller.signal) };
        case "songs":
          return {
            ...EMPTY,
            songs: await client.songs(0, 100, controller.signal),
          };
        case "folders":
          // The folder tree is derived from every song's path, so the whole
          // library is read rather than the first page.
          return {
            ...EMPTY,
            songs: await client.allSongs({ signal: controller.signal }),
          };
        case "favorites": {
          const results = await client.favorites(controller.signal);
          return {
            ...EMPTY,
            songs: results.song,
            albums: results.album,
            artists: results.artist,
          };
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
          const artist = await client.artist(route.id!, controller.signal);
          const [libraryAlbums, artistResults] = await Promise.all([
            client.albums("alphabeticalByName", 500, 0, controller.signal),
            client.search(artist.name, {}, controller.signal),
          ]);
          const artistSongs = sortArtistSongsByPopularity(Array.from(
            new Map(
              artistResults.song
                .filter(
                  (song) =>
                    song.artistId === artist.id ||
                    song.artist?.trim().toLocaleLowerCase() ===
                      artist.name.trim().toLocaleLowerCase(),
                )
                .map((song) => [song.id, song]),
            ).values(),
          ));
          return {
            ...EMPTY,
            artist,
            albums: artist.album || [],
            artistSongs,
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
        case "stats":
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
        if (result.recommendationCandidates.length)
          setHomeRecommendationCandidates(result.recommendationCandidates);
        if (result.recommendationPool.length)
          setHomeRecommendationPool(result.recommendationPool);
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
    // Recently Played needs live local history while it is open. Home does
    // not: playback must not silently rotate its collection.
    route.page === "played" ? listeningEvents : null,
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
        writeLocalFavoriteSet(LOCAL_FAVORITES_KEY, "local:", next);
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
  const isAlbumFavorite = useCallback(
    (album: AlbumRecord) =>
      albumFavorites[album.id] ?? Boolean(album.starred),
    [albumFavorites],
  );
  const isArtistFavorite = useCallback(
    (artist: Artist) => artistFavorites[artist.id] ?? Boolean(artist.starred),
    [artistFavorites],
  );
  const favoriteAlbum = useCallback(
    async (album: AlbumRecord) => {
      const wasFavorite = isAlbumFavorite(album);
      if (
        !client ||
        sourceMode === "local" ||
        album.id.startsWith("local-album:")
      ) {
        setAlbumFavorites((current) => {
          const next = { ...current, [album.id]: !wasFavorite };
          writeLocalFavoriteSet(LOCAL_ALBUM_FAVORITES_KEY, "local-album:", next);
          return next;
        });
        notify(
          wasFavorite
            ? "Removed from favorites."
            : `Added ${albumName(album)} to favorites.`,
        );
        return;
      }
      if (albumFavoritePending.has(album.id)) return;
      setAlbumFavoritePending((old) => new Set(old).add(album.id));
      try {
        await client.starAlbum(album.id, wasFavorite);
        setAlbumFavorites((old) => ({ ...old, [album.id]: !wasFavorite }));
        notify(
          wasFavorite
            ? "Removed from favorite albums."
            : `Added ${albumName(album)} to favorite albums.`,
        );
      } catch {
        notify("Could not update this favorite. Try again.");
      } finally {
        setAlbumFavoritePending((old) => {
          const next = new Set(old);
          next.delete(album.id);
          return next;
        });
      }
    },
    [albumFavoritePending, client, isAlbumFavorite, notify, sourceMode],
  );
  const favoriteArtist = useCallback(
    async (artist: Artist) => {
      const wasFavorite = isArtistFavorite(artist);
      if (
        !client ||
        sourceMode === "local" ||
        artist.id.startsWith("local-artist:")
      ) {
        setArtistFavorites((current) => {
          const next = { ...current, [artist.id]: !wasFavorite };
          writeLocalFavoriteSet(
            LOCAL_ARTIST_FAVORITES_KEY,
            "local-artist:",
            next,
          );
          return next;
        });
        notify(
          wasFavorite
            ? "Removed from favorites."
            : `Added ${artist.name} to favorites.`,
        );
        return;
      }
      if (artistFavoritePending.has(artist.id)) return;
      setArtistFavoritePending((old) => new Set(old).add(artist.id));
      try {
        await client.starArtist(artist.id, wasFavorite);
        setArtistFavorites((old) => ({ ...old, [artist.id]: !wasFavorite }));
        notify(
          wasFavorite
            ? "Removed from favorite artists."
            : `Added ${artist.name} to favorite artists.`,
        );
      } catch {
        notify("Could not update this favorite. Try again.");
      } finally {
        setArtistFavoritePending((old) => {
          const next = new Set(old);
          next.delete(artist.id);
          return next;
        });
      }
    },
    [artistFavoritePending, client, isArtistFavorite, notify, sourceMode],
  );
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
        await client.updatePlaylist(playlistDraft.playlist.id, {
          name,
          comment:
            playlistDraft.comment?.trim().slice(0, PLAYLIST_DESCRIPTION_MAX_LENGTH) ||
            "",
          public: Boolean(playlistDraft.public),
        });
        await refreshPlaylistNavigation();
        requestRefresh();
        notify("Playlist updated.");
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
  const addSongsToPlaylist = useCallback(async (
    playlist: Playlist,
    songs: Song[],
  ) => {
    if (!client || sourceMode === "local" || playlistMutationBusy || !songs.length)
      return;
    setPlaylistMutationBusy(true);
    try {
      await client.updatePlaylist(playlist.id, {
        songIdsToAdd: songs.map((song) => song.id),
      });
      await refreshPlaylistNavigation();
      invalidatePlaylistPage(playlist.id);
      if (route.page === "playlist" && route.id === playlist.id) requestRefresh();
      setPlaylistPickerSongs(null);
      songs.forEach((song) => {
        recordEngagement({
          kind: "playlist-add",
          entity: engagementEntityForSong(song),
        });
        learnFromOutcome(rewardTargetForSong(song), 0.85);
      });
      notify(
        songs.length === 1
          ? `Added “${songs[0].title}” to ${playlist.name}.`
          : `Added ${songs.length} songs to ${playlist.name}.`,
      );
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
  // Playlists only support appending and index removal, so moving a track is
  // a remove followed by a re-add with the following songs shifted up.
  const movePlaylistTrack = useCallback(async (
    playlist: Playlist,
    fromIndex: number,
    toIndex: number,
  ) => {
    if (!client || sourceMode === "local" || playlistMutationBusy) return;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= playlistSongsRef.current.length ||
      toIndex >= playlistSongsRef.current.length
    )
      return;
    const list = playlistSongsRef.current;
    setPlaylistMutationBusy(true);
    try {
      const moving = list[fromIndex];
      // Remove the track, then reinsert it by removing and re-adding the
      // affected range so the server ends up with the requested order.
      const reordered = [...list];
      const [entry] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, entry);
      const removeIndexes = list
        .map((_, index) => index)
        .filter((index) => index >= Math.min(fromIndex, toIndex));
      await client.updatePlaylist(playlist.id, {
        songIndexesToRemove: removeIndexes.sort((a, b) => b - a),
      });
      await client.updatePlaylist(playlist.id, {
        songIdsToAdd: reordered
          .slice(Math.min(fromIndex, toIndex))
          .map((song) => song.id),
      });
      setPending(true);
      requestRefresh();
      notify("Playlist order updated.");
    } catch (error) {
      notify(
        error instanceof Error
          ? `Could not reorder playlist: ${error.message}`
          : "Could not reorder playlist. Try again.",
      );
    } finally {
      setPlaylistMutationBusy(false);
    }
  }, [
    client,
    notify,
    playlistMutationBusy,
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
            label: "Play Last",
            icon: <ListEnd size={16} />,
            onSelect: () => queueSong(contextTarget.item),
          },
          { separator: true },
          ...(sourceMode === "navidrome"
            ? [
                {
                  label: "Add to Playlist",
                  icon: <ListMusic size={16} />,
                  onSelect: () => setPlaylistPickerSongs([contextTarget.item]),
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
            label: "Copy Share Link",
            icon: <Copy size={16} />,
            onSelect: () => shareSong(contextTarget.item),
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
            label: "Play Last",
            icon: <ListEnd size={16} />,
            onSelect: () => void queueAlbum(contextTarget.item),
          },
          { separator: true },
          {
            label: isAlbumFavorite(contextTarget.item)
              ? "Remove Favorite"
              : "Favorite",
            icon: <Star size={16} />,
            onSelect: () => void favoriteAlbum(contextTarget.item),
          },
          {
            label: isPinned("album", contextTarget.item.id)
              ? "Unpin Album"
              : "Pin Album",
            icon: <Pin size={16} />,
            onSelect: () =>
              togglePin({
                kind: "album",
                id: contextTarget.item.id,
                name: albumName(contextTarget.item),
                coverArt: contextTarget.item.coverArt,
                imageUrl: contextTarget.item.localArtworkUrl,
              }),
          },
          {
            label: "Copy Share Link",
            icon: <Copy size={16} />,
            onSelect: () => shareAlbum(contextTarget.item),
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
  const pageContextItems: ContextMenuItem[] = [
    {
      label: "Back",
      icon: <ChevronLeft size={16} />,
      disabled: history.length <= 1 && route.page === "home",
      onSelect: back,
    },
    {
      label: "Forward",
      icon: <ChevronRight size={16} />,
      onSelect: () => window.history.forward(),
    },
    { separator: true },
    {
      label: "Reload",
      icon: <RefreshCw size={15} />,
      onSelect: () => window.location.reload(),
    },
    {
      label: window.getSelection()?.toString().trim()
        ? "Copy selection"
        : "Copy page link",
      icon: <Copy size={15} />,
      onSelect: () => {
        const selection = window.getSelection()?.toString().trim();
        const copy = navigator.clipboard?.writeText(
          selection || window.location.href,
        );
        if (!copy) {
          notify("Copying was blocked by the browser.");
          return;
        }
        void copy
          .then(() => notify(selection ? "Selection copied." : "Page link copied."))
          .catch(() => notify("Copying was blocked by the browser."));
      },
    },
  ];
  const showSearch = () => {
    if (route.page !== "search") navigate({ page: "search" });
  };
  const canSelectSongs =
    route.page === "songs" ||
    route.page === "playlist" ||
    route.page === "album" ||
    (route.page === "favorites" && favoritesTab === "songs") ||
    (route.page === "played" && playedTab === "songs") ||
    (route.page === "search" && Boolean(debouncedQuery));
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
          player.toggleMute();
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
          if (compactLayout) setMobileSidebar((open) => !open);
          else setSidebarCollapsed((collapsed) => !collapsed);
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
        case "goFolders":
          navigate({ page: "folders" });
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
    compactLayout,
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
  const artistSongs = useMemo(
    () => sortArtistSongsByPopularity(data.artistSongs),
    [data.artistSongs],
  );
  const artistSongsExpanded = expandedArtistSongsId === data.artist?.id;
  const visibleArtistSongs = artistSongsExpanded
    ? artistSongs
    : artistSongs.slice(0, 8);
  const latestArtistAlbum = useMemo(
    () =>
      [...visibleAlbums].sort(
        (left, right) => (right.year || 0) - (left.year || 0),
      )[0],
    [visibleAlbums],
  );
  const artistSongsHavePopularity = artistSongs.some((song) =>
    Number.isFinite(song.playCount),
  );
  const displayPins = useMemo(
    () =>
      pins.map((pin) => {
        if (pin.coverArt || pin.imageUrl) return pin;
        if (pin.kind === "album") {
          const album = [
            ...data.albums,
            ...data.recent,
            ...data.recentlyPlayed,
            ...data.frequent,
            data.album,
          ].find((candidate) => candidate?.id === pin.id);
          return album
            ? { ...pin, coverArt: album.coverArt, imageUrl: album.localArtworkUrl }
            : pin;
        }
        if (pin.kind === "artist") {
          const artist = [...data.artists, data.artist].find(
            (candidate) => candidate?.id === pin.id,
          );
          return artist
            ? {
                ...pin,
                coverArt: artist.coverArt,
                imageUrl: artist.artistImageUrl || artist.localArtworkUrl,
              }
            : pin;
        }
        const playlist = [...sidebarPlaylists, data.playlist].find(
          (candidate) => candidate?.id === pin.id,
        );
        return playlist ? { ...pin, coverArt: playlist.coverArt } : pin;
      }),
    [
      data.album,
      data.albums,
      data.artist,
      data.artists,
      data.frequent,
      data.recent,
      data.recentlyPlayed,
      data.playlist,
      pins,
      sidebarPlaylists,
    ],
  );
  // Recently played songs live in their own field; they are hydrated from the
  // local listening profile rather than the server's song list.
  const visiblePlayedSongs = useMemo(
    () =>
      data.recentlyPlayedSongs.filter((song) =>
        (song.title + " " + song.artist + " " + song.album)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [data.recentlyPlayedSongs, filter],
  );
  const sortedSongs = useMemo(() => {
    if (songSort === "default") return visibleSongs;
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: "base",
    });
    const field = (song: Song) =>
      songSort === "title"
        ? song.title
        : songSort === "artist"
          ? song.artist || ""
          : song.album || "";
    return [...visibleSongs].sort((a, b) => collator.compare(field(a), field(b)));
  }, [songSort, visibleSongs]);
  const sortedArtists = useMemo(() => {
    if (artistSort === "albums")
      return [...visibleArtists].sort(
        (a, b) => (b.albumCount || 0) - (a.albumCount || 0),
      );
    return visibleArtists;
  }, [artistSort, visibleArtists]);
  const renderedArtists = useMemo(
    () => sortedArtists.slice(0, renderLimit),
    [renderLimit, sortedArtists],
  );
  const renderedSongs = useMemo(
    () =>
      route.page === "favorites" ||
      (sourceMode === "local" && route.page === "songs")
        ? sortedSongs.slice(0, renderLimit)
        : sortedSongs,
    [renderLimit, route.page, sortedSongs, sourceMode],
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
      libraryPool: data.recommendationPool,
      recentlyPlayed: data.recentlyPlayed,
      frequentlyPlayed: data.frequent,
      recentlyAdded: data.recent,
      favoriteAlbumIds: new Set(data.favoriteAlbumIds),
      contextSongs,
      excludeAlbumIds: excluded,
      listeningProfile,
      engagementProfile,
      rankerModel,
      tuning: recommendationTuning,
      limit: recommendationTuning.slateSize,
    });
  }, [
    data.favoriteAlbumIds,
    data.frequent,
    data.recent,
    data.recentlyPlayed,
    data.recommendationCandidates,
    data.recommendationPool,
    discoveryAlbums,
    engagementProfile,
    listeningProfile,
    player.currentIndex,
    player.queue,
    rankerModel,
    recommendationTuning,
    sourceMode,
  ]);
  const recommendedAlbums = useMemo(
    () => recommendedResults.map((recommendation) => recommendation.album),
    [recommendedResults],
  );
  // Settings uses this to show a live slate that reacts to the tuning dials as
  // the listener drags them, using the same candidates the Home shelf ranks.
  // Home's page data is intentionally emptied while Settings is routed, so the
  // last real Home context is snapshotted here instead.
  // The full personalization context for the engine preview. The preview must
  // rank with the same signals the real shelf uses, otherwise the dials would
  // appear to do nothing: with no listening history every candidate collapses
  // to the same score and only the exploration term survives.
  const recommendationPreviewContext = useMemo(
    () => ({
      candidates: homeRecommendationCandidates,
      libraryPool: homeRecommendationPool,
      discoveryCandidates: discoveryAlbums,
      recentlyPlayed: data.recentlyPlayed,
      frequentlyPlayed: data.frequent,
      recentlyAdded: data.recent,
      favoriteAlbumIds: new Set(data.favoriteAlbumIds),
      listeningProfile,
      engagementProfile,
      rankerModel,
    }),
    [
      data.favoriteAlbumIds,
      data.frequent,
      data.recent,
      data.recentlyPlayed,
      discoveryAlbums,
      engagementProfile,
      homeRecommendationCandidates,
      homeRecommendationPool,
      listeningProfile,
      rankerModel,
    ],
  );
  // Exposures are persisted without changing the current slate underneath the
  // listener. Refresh that snapshot on the next Home visit or explicit action.
  useEffect(() => {
    if (route.page === "home" && listeningHistoryEnabled)
      setEngagementEvents(readEngagement(listeningStorage, engagementKey));
  }, [route.page, listeningHistoryEnabled, listeningStorage, engagementKey]);
  useEffect(() => {
    recommendedAlbumIds.current = new Set(recommendedAlbums.map((album) => album.id));
    if (route.page !== "home" || !listeningHistoryEnabled || !impressionKey) return;
    const root = document.querySelector(".recommendations-section");
    if (!root) return;
    return observeRecommendationVisibility(root, (position) => {
      const recommendation = recommendedResults[position];
      if (!recommendation) return;
      const now = Date.now();
      const album = recommendation.album;
      const bucket = Math.floor(now / (30 * 60 * 1000));
      const id = `seen:${album.id}:${bucket}`;
      // Persisted exposure IDs survive reward consumption and remounts.
      if (readEngagement(listeningStorage, engagementKey).some((event) => event.id === id)) return;
      const entity = {
        type: "album" as const, id: album.id, name: album.name || album.title,
        artistId: album.artistId || album.artist, genre: album.genre,
      };
      const event = createEngagementEvent({ kind: "recommendation-impression", at: now, entity, position });
      appendEngagement(listeningStorage, engagementKey, { ...event, id });
      const impression: PendingImpression = {
        id, at: now, albumId: album.id.trim().toLowerCase(),
        artistId: (album.artistId || album.artist || "").trim().toLowerCase(),
        genres: splitGenres(album.genre).map((genre) => genre.toLowerCase()),
        features: { ...recommendation.features, learned: 0 }, position,
      };
      impressionsRef.current = writeImpressions(listeningStorage, impressionKey,
        [...impressionsRef.current, impression]);
    });
  }, [route.page, engagementKey, impressionKey, listeningHistoryEnabled,
    listeningStorage, recommendedAlbums, recommendedResults]);
  const addInfinitePlay = useCallback(async () => {
    if (!client || sourceMode === "local" || infinitePlayBusy) return;
    setInfinitePlayBusy(true);
    try {
      const existing = new Set(player.queue.map((song) => song.id));
      // Random mode can return songs that are already queued, which shrinks the
      // usable pool. Fetch a generous batch and retry so the request still
      // fills instead of quietly adding a handful of tracks.
      const fillWithRandom = async (wanted: number) => {
        const picked = new Set(existing);
        const collected: Song[] = [];
        for (let attempt = 0; attempt < 3 && collected.length < wanted; attempt++) {
          const batch = await client
            .randomSongs(Math.max(wanted * 2, 40))
            .catch(() => [] as Song[]);
          if (!batch.length) break;
          for (const song of batch) {
            if (collected.length >= wanted) break;
            if (!song?.id || picked.has(song.id)) continue;
            if (engagementProfile.mutes.has(`artist:${(song.artistId || song.albumArtist || song.artist || "").trim().toLowerCase()}`)) continue;
            picked.add(song.id);
            collected.push(song);
          }
        }
        return collected;
      };
      let candidates: Song[] = [];
      if (infinitePlayMode === "random") {
        candidates = await fillWithRandom(infinitePlayCount);
      } else {
        // Albums already sitting in the queue, so a refill prefers material the
        // listener has not just heard.
        const queuedAlbumIds = new Set(
          player.queue
            .map((song) => song.albumId?.trim())
            .filter((id): id is string => Boolean(id)),
        );
        const albumIds = rankInfinitePlayAlbums({
          shelfIds: recommendedAlbums.map((album) => album.id),
          poolIds: homeRecommendationPool.map((album) => album.id),
          queuedAlbumIds,
        });
        // There is deliberately no cap on how many distinct albums a fill may
        // draw from, so we cannot fetch one album per request: that would mean
        // thousands of round trips on a large library. Read the library's songs
        // in bulk instead, ranked album order first, then group by album.
        const groups = await loadRankedAlbumSongs(
          albumIds,
          // Keep the opening batch broad even when the first albums in the
          // catalogue contain many tracks. The loader caps this target so a
          // large user-selected fill does not require a full-library scan.
          infinitePlayAlbumTarget(infinitePlayCount),
          (offset, size) => client.songs(offset, size),
          // Keep paging until there are comfortably more songs than needed, so
          // a library of short albums still yields a varied fill.
          {
            wantedSongs: Math.max(40, infinitePlayCount * 2),
            excludeAlbumIds: queuedAlbumIds,
          },
        );
        // One track per album per round, so the request samples many albums
        // instead of draining a few.
        // Rank the albums actually retrieved as well as the Home shelf. Bulk
        // song retrieval can include albums outside the initial recommendation.
        const metadata = new Map(homeRecommendationPool.map((album) => [album.id, album]));
        const allowedGroups = groups.map((group) => ({ ...group, songs: group.songs.filter((song) =>
          !engagementProfile.mutes.has(`artist:${(song.artistId || song.albumArtist || song.artist || "").trim().toLowerCase()}`)),
        })).filter((group) => group.songs.length);
        const ranked = rankAlbumRecommendations({
          ...recommendationPreviewContext,
          candidates: allowedGroups.map((group) => metadata.get(group.albumId) || songAlbumCandidates(group.songs)[0]).filter(Boolean),
          libraryPool: [], discoveryCandidates: [], tuning: recommendationTuning,
          contextSongs: player.queue.slice(Math.max(0, player.currentIndex), Math.max(0, player.currentIndex) + 4),
          limit: allowedGroups.length,
        });
        const groupsById = new Map(allowedGroups.map((group) => [group.albumId, group]));
        candidates = interleaveAlbumSongs(ranked.map((item) => groupsById.get(item.album.id)!).filter(Boolean), infinitePlayCount, existing);
        // Last resort: random songs, so a fill never silently adds nothing.
        if (candidates.length < infinitePlayCount) {
          const picked = new Set(candidates.map((song) => song.id));
          const filler = await fillWithRandom(
            infinitePlayCount - candidates.length,
          );
          for (const song of filler) {
            if (candidates.length >= infinitePlayCount) break;
            if (picked.has(song.id)) continue;
            picked.add(song.id);
            candidates.push(song);
          }
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
    homeRecommendationPool,
    engagementProfile,
    recommendationPreviewContext,
    recommendationTuning,
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
    (songs: Song[], index: number, restart = false) => {
      const song = songs[index];
      if (song?.id === player.currentSong?.id) {
        if (restart) player.restart();
        else player.toggle();
        return;
      }
      player.playSongs(songs, index);
    },
    [player.currentSong?.id, player.playSongs, player.restart, player.toggle],
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
  const canEditPlaylist = Boolean(
    sourceMode === "navidrome" &&
      data.playlist &&
      !data.playlist.readonly &&
      (!data.playlist.owner || data.playlist.owner === account.username),
  );
  // Which list the selection actions apply to. Album track lists are compact
  // tables; the main song tables and playlist views use multi-select.
  const selectionSongs =
    route.page === "search"
      ? data.songs
      : route.page === "favorites"
        ? renderedSongs
        : route.page === "playlist" || route.page === "album"
          ? visibleSongs
          : route.page === "played" && playedTab === "songs"
            ? visiblePlayedSongs
            : renderedSongs;
  const selectedSongs = useMemo(
    () =>
      [...selectedIndexes]
        .sort((a, b) => a - b)
        .map((index) => selectionSongs[index])
        .filter(Boolean),
    [selectedIndexes, selectionSongs],
  );
  const clearSelection = useCallback(() => {
    setSelectedIndexes(new Set());
    selectionAnchor.current = null;
  }, []);
  useEffect(() => {
    // Selection only makes sense for the list currently on screen.
    setSelecting(false);
    clearSelection();
  }, [clearSelection, route.page, route.id, debouncedQuery]);
  const toggleSongSelection = useCallback(
    (index: number, shiftKey: boolean) => {
      setSelectedIndexes((current) => {
        const next = new Set(current);
        if (shiftKey && selectionAnchor.current !== null) {
          const [start, end] = [
            Math.min(selectionAnchor.current, index),
            Math.max(selectionAnchor.current, index),
          ];
          for (let cursor = start; cursor <= end; cursor++) next.add(cursor);
          return next;
        }
        if (next.has(index)) next.delete(index);
        else next.add(index);
        selectionAnchor.current = index;
        return next;
      });
    },
    [],
  );
  const toggleSelectAll = useCallback(() => {
    setSelectedIndexes((current) =>
      current.size === selectionSongs.length
        ? new Set()
        : new Set(selectionSongs.map((_, index) => index)),
    );
  }, [selectionSongs]);
  const bulkRun = useCallback(
    async (action: (songs: Song[]) => void | Promise<void>) => {
      if (!selectedSongs.length || bulkBusy) return;
      setBulkBusy(true);
      try {
        await action(selectedSongs);
        setSelecting(false);
        clearSelection();
      } finally {
        setBulkBusy(false);
      }
    },
    [bulkBusy, clearSelection, selectedSongs],
  );
  const bulkAddToPlaylist = useCallback(
    (songs: Song[]) => {
      if (sourceMode !== "navidrome") return;
      setPlaylistPickerSongs(songs);
    },
    [sourceMode],
  );
  const bulkRemoveFromPlaylist = useCallback(
    async (songs: Song[]) => {
      if (!client || !data.playlist || !canEditPlaylist) return;
      // Remove by original index, highest first, so earlier indexes stay valid.
      const indexes = [...selectedIndexes].sort((a, b) => b - a);
      if (!indexes.length) return;
      try {
        await client.updatePlaylist(data.playlist.id, {
          songIndexesToRemove: indexes,
        });
        await refreshPlaylistNavigation();
        requestRefresh();
        notify(
          `Removed ${songs.length} song${songs.length === 1 ? "" : "s"} from the playlist.`,
        );
      } catch {
        notify("Could not update this playlist. Try again.");
      }
    },
    [
      client,
      canEditPlaylist,
      data.playlist,
      notify,
      refreshPlaylistNavigation,
      requestRefresh,
      selectedIndexes,
    ],
  );
  const bulkFavorite = useCallback(
    async (songs: Song[]) => {
      const allFavorite = songs.every((song) => isFavorite(song));
      for (const song of songs) {
        if (isFavorite(song) === allFavorite) continue;
        await favorite(song);
      }
      notify(
        allFavorite
          ? `Removed ${songs.length} favorite${songs.length === 1 ? "" : "s"}.`
          : `Favorited ${songs.length} song${songs.length === 1 ? "" : "s"}.`,
      );
    },
    [favorite, isFavorite, notify],
  );
  // Kept above the list in the DOM so `position: sticky; top: 0` can pin it to
  // the top of the scroll area instead of fighting the floating playback dock.
  const bulkBar = selecting ? (
    <div className="bulk-bar" role="region" aria-label="Selected songs">
      <span className="bulk-count">
        {selectedSongs.length ? (
          <>
            <b>{selectedSongs.length}</b> selected
          </>
        ) : (
          "Select songs"
        )}
      </span>
      <div className="bulk-actions">
        <button
          className="secondary-button"
          disabled={!selectedSongs.length || bulkBusy}
          onClick={() =>
            void bulkRun((songs) => {
              player.playSongs(songs);
            })
          }
        >
          <Play size={14} fill="currentColor" />
          Play
        </button>
        <button
          className="secondary-button"
          disabled={!selectedSongs.length || bulkBusy}
          onClick={() =>
            void bulkRun((songs) => {
              [...songs].reverse().forEach((song) => queueSong(song, true));
            })
          }
        >
          <ListPlus size={14} />
          Play Next
        </button>
        <button
          className="secondary-button"
          disabled={!selectedSongs.length || bulkBusy}
          onClick={() =>
            void bulkRun((songs) => {
              songs.forEach((song) => queueSong(song));
            })
          }
        >
          <ListEnd size={14} />
          Add to Queue
        </button>
        {sourceMode === "navidrome" && (
          <button
            className="secondary-button"
            disabled={!selectedSongs.length || bulkBusy}
            onClick={() => void bulkRun((songs) => bulkAddToPlaylist(songs))}
          >
            <ListMusic size={14} />
            Add to Playlist
          </button>
        )}
        <button
          className="secondary-button"
          disabled={!selectedSongs.length || bulkBusy}
          onClick={() => void bulkRun((songs) => bulkFavorite(songs))}
        >
          <Star size={14} />
          Favorite
        </button>
        {route.page === "playlist" && canEditPlaylist && (
          <button
            className="secondary-button"
            disabled={!selectedSongs.length || bulkBusy}
            onClick={() => void bulkRun((songs) => bulkRemoveFromPlaylist(songs))}
          >
            <X size={14} />
            Remove
          </button>
        )}
        <button
          className="secondary-button"
          onClick={clearSelection}
          disabled={!selectedSongs.length}
        >
          Clear
        </button>
      </div>
    </div>
  ) : null;
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
        diagnosis={connectionDiagnosis}
        onDismissDiagnosis={() => setConnectionDiagnosis(null)}
        accounts={accounts}
        onUseAccount={(account) =>
          void connect(
            {
              server: account.server,
              username: account.username,
              password: "",
              auth: account.auth,
            },
            true,
          )
        }
        onForgetAccount={forgetAccount}
        localMusic={localMusic}
        localMusicBusy={localMusicBusy}
        localMusicError={localMusicError}
        localMusicInputRef={localMusicInputRef}
        onChooseLocalMusic={chooseMusicFolder}
        onImportLocalMusic={importMusicFolder}
        onOpenLocalMusic={openLocalLibrary}
      />
    );
  const songTable = (
    songs: Song[],
    compact = false,
    resultNavigation = true,
    playlist?: Playlist,
  ) => {
    playlistSongsRef.current = playlist ? songs : playlistSongsRef.current;
    return (
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
      onShare={shareSong}
      onContextMenu={openSongContextMenu}
      onAddToPlaylist={
        sourceMode === "navidrome"
          ? (song) => setPlaylistPickerSongs([song])
          : undefined
      }
      onRemoveFromPlaylist={
        playlist && canEditPlaylist
          ? (_song, index) => void removeSongFromPlaylist(playlist, index)
          : undefined
      }
      onReorder={
        playlist && canEditPlaylist && !selecting
          ? (from, to) => void movePlaylistTrack(playlist, from, to)
          : undefined
      }
      reordered={Boolean(playlist && canEditPlaylist)}
      playlistView={Boolean(playlist)}
      compact={compact}
      resultNavigation={resultNavigation}
      selecting={selecting}
      selectedIndexes={selectedIndexes}
      onToggleSelect={toggleSongSelection}
      onToggleSelectAll={toggleSelectAll}
    />
    );
  };
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
                  style={
                    {
                      "--progress": `${((scalePreview - 70) / 80) * 100}%`,
                    } as CSSProperties
                  }
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
        (sidebarCollapsed ? " sidebar-collapsed" : "") +
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
      <LibrarySidebar
        account={account}
        active={active}
        alternateVersionUrl={alternateVersionUrl}
        client={client}
        collapsed={sidebarCollapsed}
        collapseShortcut={formatShortcut(shortcuts.toggleSidebar)}
        isBetaHost={isBetaHost}
        modifierLabel={modifierLabel}
        navigate={navigate}
        onCloseMobile={() => setMobileSidebar(false)}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        pinKey={pinKey}
        pins={displayPins}
        route={route}
        searchRef={searchRef}
        showSearch={showSearch}
        sidebarPlaylists={sidebarPlaylists}
        sourceMode={sourceMode}
        togglePin={togglePin}
        warmSection={warmSection}
      />

      <div className="workspace">
        <header className={"window-toolbar" + (["search", "genre"].includes(route.page) ? " search-toolbar" : "")}>
          <div className="toolbar-leading">
            <IconButton
              label="Toggle navigation"
              onClick={() => {
                if (compactLayout) setMobileSidebar(!mobileSidebar);
                else setSidebarCollapsed(!sidebarCollapsed);
              }}
            >
              {compactLayout ? (
                <PanelLeft size={18} />
              ) : sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </IconButton>
            <IconButton
              label="Back"
              disabled={history.length < 2}
              onClick={back}
            >
              <ChevronLeft size={22} />
            </IconButton>
            <span>{route.page === "settings" || route.page === "stats" ? title : isDetail ? title : "Your Library"}</span>
          </div>
          <div className="toolbar-trailing">
            {route.page === "settings" || route.page === "folders" || route.page === "stats" ? null : (
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
          className={
            "main-content" +
            (route.page === "artist" ? " artist-page-content" : "")
          }
          id="main-content"
          aria-busy={pending}
        >
          {pending && data !== EMPTY && route.page !== "settings" && route.page !== "stats" && (
            <div className="view-refreshing" role="status" aria-label="Updating library">
              <LoaderCircle className="spin" size={15} />
            </div>
          )}
          {pending && data === EMPTY && route.page !== "search" && route.page !== "settings" && route.page !== "stats" ? (
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
                  <div className="page-heading-actions">
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
                  {(route.page === "songs" ||
                    (route.page === "favorites" && favoritesTab === "songs")) && (
                    <label className="sort-control">
                      <ArrowDownWideNarrow size={16} />
                      <select
                        aria-label="Sort songs"
                        value={songSort}
                        onChange={(event) => setSongSort(event.target.value)}
                      >
                        <option value="default">Default order</option>
                        <option value="title">Title</option>
                        <option value="artist">Artist</option>
                        <option value="album">Album</option>
                      </select>
                    </label>
                  )}
                  {(route.page === "artists" ||
                    (route.page === "favorites" && favoritesTab === "artists")) && (
                    <label className="sort-control">
                      <ArrowDownWideNarrow size={16} />
                      <select
                        aria-label="Sort artists"
                        value={artistSort}
                        onChange={(event) => setArtistSort(event.target.value)}
                      >
                        <option value="name">Name</option>
                        <option value="albums">Most albums</option>
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
                  {canSelectSongs && (
                    <button
                      className={
                        "secondary-button select-button" +
                        (selecting ? " selected" : "")
                      }
                      aria-pressed={selecting}
                      onClick={() => {
                        setSelecting((value) => !value);
                        clearSelection();
                      }}
                    >
                      <CheckSquare size={15} />
                      {selecting ? "Done" : "Select"}
                    </button>
                  )}
                  </div>
                </div>
              )}
              {bulkBar}
              {route.page === "settings" && (
                <SettingsView
                  account={account}
                  accounts={accounts}
                  animatedArtwork={animatedArtwork}
                  animateArtworkEverywhere={animateArtworkEverywhere}
                  betaChannel={betaChannel}
                  beginInterfaceScalePreview={beginInterfaceScalePreview}
                  connect={connect}
                  connecting={connecting}
                  crossfadeSeconds={crossfadeSeconds}
                  volumeScrollStep={volumeScrollStep}
                  volumeShiftScrollStep={volumeShiftScrollStep}
                  disconnect={disconnect}
                  engagementEvents={engagementEvents}
                  experimentalArtworkLoading={experimentalArtworkLoading}
                  externalLyricsEnabled={externalLyricsEnabled}
                  lyricsBlurEnabled={lyricsBlurEnabled}
                  floatingSidebar={floatingSidebar}
                  forgetAccount={forgetAccount}
                  frameMonitorEnabled={frameMonitor}
                  infinitePlayBusy={infinitePlayBusy}
                  infinitePlayCount={infinitePlayCount}
                  infinitePlayEnabled={infinitePlayEnabled}
                  infinitePlayMode={infinitePlayMode}
                  interfaceScale={interfaceScale}
                  listeningEvents={listeningEvents}
                  listeningHistoryEnabled={listeningHistoryEnabled}
                  normalization={normalization}
                  notify={notify}
                  openEngine={() => setEngineOpen(true)}
                  player={player}
                  rankerModel={rankerModel}
                  refreshCollectionOnVisit={refreshCollectionOnVisit}
                  resetLearning={resetLearning}
                  setAnimatedArtwork={setAnimatedArtwork}
                  setAnimateArtworkEverywhere={setAnimateArtworkEverywhere}
                  setCrossfadeSeconds={setCrossfadeSeconds}
                  setVolumeScrollStep={setVolumeScrollStep}
                  setVolumeShiftScrollStep={setVolumeShiftScrollStep}
                  setExperimentalArtworkLoading={setExperimentalArtworkLoading}
                  setExternalLyricsEnabled={setExternalLyricsEnabled}
                  setLyricsBlurEnabled={setLyricsBlurEnabled}
                  setFloatingSidebar={setFloatingSidebar}
                  setFrameMonitorEnabled={setFrameMonitor}
                  setInfinitePlayCount={setInfinitePlayCount}
                  setInfinitePlayMode={setInfinitePlayMode}
                  setListeningEvents={setListeningEvents}
                  setListeningHistoryEnabled={setListeningHistoryEnabled}
                  setListeningHistoryOpen={setListeningHistoryOpen}
                  setNormalization={setNormalization}
                  setRefreshCollectionOnVisit={setRefreshCollectionOnVisit}
                  setShareProvider={setShareProvider}
                  setShortcutQuery={setShortcutQuery}
                  setRecordingShortcut={setRecordingShortcut}
                  setShortcutsOpen={setShortcutsOpen}
                  setTheme={setTheme}
                  settingsFocus={route.focus}
                  sourceMode={sourceMode}
                  shareProvider={shareProvider}
                  theme={theme}
                  transitionMode={transitionMode}
                  setTransitionMode={setTransitionMode}
                  toggleInfinitePlay={toggleInfinitePlay}
                  trackingKey={trackingKey}
                  warnBeforeLeave={warnBeforeLeave}
                  setWarnBeforeLeave={setWarnBeforeLeave}
                />
              )}
              {route.page === "stats" && (
                <Suspense fallback={<LoadingState />}>
                  <StatsView
                    client={client}
                    enabled={listeningHistoryEnabled}
                    events={listeningEvents}
                    onOpenSettings={() => navigate({ page: "settings" })}
                  />
                </Suspense>
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
              {route.page === "played" && (
                <>
                  <div
                    className="favorites-tabs"
                    role="tablist"
                    aria-label="Recently played types"
                  >
                    {(["albums", "songs"] as const).map((tab) => (
                      <button
                        key={tab}
                        role="tab"
                        aria-selected={playedTab === tab}
                        className={playedTab === tab ? "selected" : ""}
                        onClick={() => setPlayedTab(tab)}
                      >
                        {tab === "albums" ? "Albums" : "Songs"}
                      </button>
                    ))}
                  </div>
                  {playedTab === "albums" &&
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
                  {playedTab === "songs" &&
                    (visiblePlayedSongs.length ? (
                      songTable(visiblePlayedSongs)
                    ) : (
                      <EmptyState
                        title="No recently played songs"
                        message={
                          listeningHistoryEnabled
                            ? "Play a few songs and they will show up here, most recent first."
                            : "Turn on Personalized recommendations in Settings to keep a local listening history."
                        }
                      />
                    ))}
                </>
              )}
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
              {route.page === "songs" &&
                (visibleSongs.length ? (
                  songTable(renderedSongs)
                ) : (
                  <EmptyState
                    title="No songs found"
                    message="Try another filter or refresh your library."
                  />
                ))}
              {route.page === "folders" && (
                <FolderView
                  client={client}
                  songs={data.songs}
                  loading={pending}
                  onPlay={playSongs}
                  onContextMenu={openSongContextMenu}
                />
              )}
              {route.page === "favorites" && (
                <>
                  <div
                    className="favorites-tabs"
                    role="tablist"
                    aria-label="Favorite types"
                  >
                    {(["songs", "albums", "artists"] as const).map((tab) => (
                      <button
                        key={tab}
                        role="tab"
                        aria-selected={favoritesTab === tab}
                        className={favoritesTab === tab ? "selected" : ""}
                        onClick={() => setFavoritesTab(tab)}
                      >
                        {tab === "songs"
                          ? "Songs"
                          : tab === "albums"
                            ? "Albums"
                            : "Artists"}
                      </button>
                    ))}
                  </div>
                  {favoritesTab === "songs" &&
                    (visibleSongs.length ? (
                      songTable(renderedSongs)
                    ) : (
                      <EmptyState
                        title="No favorite songs"
                        message="Favorite a song from its menu to find it here."
                      />
                    ))}
                  {favoritesTab === "albums" &&
                    (visibleAlbums.length ? (
                      albumGrid(visibleAlbums)
                    ) : (
                      <EmptyState
                        title="No favorite albums"
                        message="Open an album and choose Favorite to find it here."
                      />
                    ))}
                  {favoritesTab === "artists" &&
                    (sortedArtists.length ? (
                      artistGrid(sortedArtists)
                    ) : (
                      <EmptyState
                        title="No favorite artists"
                        message="Open an artist and choose Favorite to find them here."
                      />
                    ))}
                </>
              )}
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
                    <div className="collection-artwork-stack">
                      <Artwork
                        client={client}
                        id={data.album?.coverArt || data.playlist?.coverArt}
                        imageUrl={data.album?.localArtworkUrl}
                        size={700}
                        className="collection-artwork-radiosity"
                        loadEager
                      />
                      <Artwork
                        client={client}
                        id={data.album?.coverArt || data.playlist?.coverArt}
                        imageUrl={data.album?.localArtworkUrl}
                        size={700}
                        eager
                      />
                    </div>
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
                          {data.playlist.comment.slice(
                            0,
                            PLAYLIST_DESCRIPTION_MAX_LENGTH,
                          )}
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
                        {route.page === "album" && data.album && (
                          <button
                            className="secondary-button"
                            data-search-result="true"
                            aria-pressed={isAlbumFavorite(data.album)}
                            onClick={() =>
                              data.album && void favoriteAlbum(data.album)
                            }
                          >
                            <Star
                              size={15}
                              fill={
                                isAlbumFavorite(data.album)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                            {isAlbumFavorite(data.album)
                              ? "Favorited"
                              : "Favorite"}
                          </button>
                        )}
                        {route.page === "playlist" && canEditPlaylist && (
                          <button
                            className="secondary-button"
                            onClick={() =>
                              data.playlist &&
                              setPlaylistDraft({
                                playlist: data.playlist,
                                name: data.playlist.name,
                                comment: data.playlist.comment || "",
                                public: Boolean(data.playlist.public),
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
                        {route.page === "album" && data.album && (
                          <button
                            className="secondary-button"
                            onClick={() => shareAlbum(data.album!)}
                          >
                            <Copy size={15} />
                            Copy Share Link
                          </button>
                        )}
                        <button
                          className={
                            "secondary-button select-button" +
                            (selecting ? " selected" : "")
                          }
                          aria-pressed={selecting}
                          disabled={!data.songs.length}
                          onClick={() => {
                            setSelecting((value) => !value);
                            clearSelection();
                          }}
                        >
                          <CheckSquare size={15} />
                          {selecting ? "Done" : "Select"}
                        </button>
                        {data.playlist && (
                          <button
                            className="secondary-button"
                            aria-pressed={isPinned("playlist", data.playlist.id)}
                            onClick={() =>
                              data.playlist &&
                              togglePin({
                                kind: "playlist",
                                id: data.playlist.id,
                                name: data.playlist.name,
                                coverArt: data.playlist.coverArt,
                              })
                            }
                          >
                            <Pin size={15} />
                            {isPinned("playlist", data.playlist.id)
                              ? "Unpin"
                              : "Pin"}
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
                <div className="artist-page">
                  <div className="artist-header">
                    <Artwork
                      client={client}
                      id={data.artist?.coverArt}
                      imageUrl={data.artist?.artistImageUrl || data.artist?.localArtworkUrl}
                      size={1200}
                      label={data.artist?.name}
                      eager
                    />
                    <div className="artist-header-shade" aria-hidden="true" />
                    {data.artist && (
                      <button
                        className="artist-share-action"
                        aria-label="Copy Share Link"
                        title="Copy Share Link"
                        onClick={() => shareArtist(data.artist!)}
                      >
                        <Copy size={17} />
                      </button>
                    )}
                    <div className="artist-header-content">
                      <h1>{data.artist?.name}</h1>
                      <p>{data.albums.length} albums in your library</p>
                      <div className="artist-actions">
                        {data.artist && (
                          <button
                            aria-label={
                              isPinned("artist", data.artist.id)
                                ? "Unpin"
                                : "Pin"
                            }
                            title={
                              isPinned("artist", data.artist.id)
                                ? "Unpin"
                                : "Pin"
                            }
                            aria-pressed={isPinned("artist", data.artist.id)}
                            onClick={() =>
                              data.artist &&
                              togglePin({
                                kind: "artist",
                                id: data.artist.id,
                                name: data.artist.name,
                                coverArt: data.artist.coverArt,
                                imageUrl:
                                  data.artist.artistImageUrl ||
                                  data.artist.localArtworkUrl,
                              })
                            }
                          >
                            <Pin size={17} fill={isPinned("artist", data.artist.id) ? "currentColor" : "none"} />
                          </button>
                        )}
                        <button
                          className="artist-play-action"
                          aria-label={`Play ${data.artist?.name || "artist"}`}
                          title={`Play ${data.artist?.name || "artist"}`}
                          disabled={!artistSongs.length}
                          onClick={() => player.playSongs(artistSongs)}
                        >
                          <Play size={25} fill="currentColor" />
                        </button>
                        {data.artist && (
                          <button
                            aria-label={
                              isArtistFavorite(data.artist)
                                ? "Favorited"
                                : "Favorite"
                            }
                            title={
                              isArtistFavorite(data.artist)
                                ? "Favorited"
                                : "Favorite"
                            }
                            aria-pressed={isArtistFavorite(data.artist)}
                            onClick={() =>
                              data.artist && void favoriteArtist(data.artist)
                            }
                          >
                            <Star
                              size={18}
                              fill={
                                isArtistFavorite(data.artist)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="artist-page-body">
                    <div className="artist-feature-grid">
                      {latestArtistAlbum && (
                        <section className="music-section artist-latest-release">
                          <div className="section-heading">
                            <h2>Latest Release</h2>
                            {latestArtistAlbum.year ? (
                              <span>{latestArtistAlbum.year}</span>
                            ) : null}
                          </div>
                          {albumGrid([latestArtistAlbum], false, true, false)}
                        </section>
                      )}
                      <section className="music-section artist-top-songs">
                        <div className="section-heading">
                          <h2>Top Songs</h2>
                          <span>
                            {artistSongsHavePopularity ? "Most played first · " : ""}
                            {artistSongs.length}
                          </span>
                        </div>
                        {artistSongs.length ? (
                          <>
                            <div id="artist-songs-list">
                              {songTable(visibleArtistSongs, false, false)}
                            </div>
                            {artistSongs.length > 8 && (
                              <div className="artist-songs-more">
                                <button
                                  className="secondary-button"
                                  type="button"
                                  aria-controls="artist-songs-list"
                                  aria-expanded={artistSongsExpanded}
                                  onClick={() =>
                                    setExpandedArtistSongsId(
                                      artistSongsExpanded
                                        ? null
                                        : data.artist?.id || null,
                                    )
                                  }
                                >
                                  {artistSongsExpanded ? "Show less" : "Show more"}
                                </button>
                                {!artistSongsExpanded && (
                                  <span>Showing the first 8 songs</span>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <EmptyState
                            title="No artist songs found"
                            message="This artist has no matching songs in the library."
                          />
                        )}
                      </section>
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
                  </div>
                </div>
              )}
              {route.page === "search" &&
                (!debouncedQuery ? (
                  <>
                    <div className="page-heading">
                      <h1>Search</h1>
                    </div>
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
                    <div
                      className="search-tabs"
                      role="tablist"
                      aria-label="Search result types"
                    >
                      {(
                        [
                          ["all", "All", data.artists.length + data.albums.length + data.songs.length],
                          ["artists", "Artists", data.artists.length],
                          ["albums", "Albums", data.albums.length],
                          ["songs", "Songs", data.songs.length],
                        ] as const
                      ).map(([value, label, count]) => (
                        <button
                          key={value}
                          role="tab"
                          aria-selected={searchTab === value}
                          className={searchTab === value ? "selected" : ""}
                          onClick={() => setSearchTab(value)}
                        >
                          {label}
                          <span className="search-tab-count">{count}</span>
                        </button>
                      ))}
                    </div>
                    {searchTab === "artists" && !data.artists.length && (
                      <p className="search-tab-empty">
                        No matching artists in your library.
                      </p>
                    )}
                    {searchTab === "albums" && !data.albums.length && (
                      <p className="search-tab-empty">
                        No matching albums in your library.
                      </p>
                    )}
                    {searchTab === "songs" && !data.songs.length && (
                      <p className="search-tab-empty">
                        No matching songs in your library.
                      </p>
                    )}
                    {(searchTab === "all" || searchTab === "artists") &&
                      data.artists.length > 0 && (
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
                    {(searchTab === "all" || searchTab === "albums") &&
                      data.albums.length > 0 && (
                      <section className="music-section">
                        <div className="section-heading">
                          <h2>Albums</h2>
                        </div>
                        {albumGrid(data.albums, true, false, true)}
                      </section>
                    )}
                    {(searchTab === "all" || searchTab === "songs") &&
                      data.songs.length > 0 && (
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
            lyricsBlurEnabled={lyricsBlurEnabled}
          />
        )}
        <PlaybackDock
          client={client}
          player={player}
          volumeScrollStep={volumeScrollStep}
          volumeShiftScrollStep={volumeShiftScrollStep}
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
      <AppDialogs
        addSongsToPlaylist={addSongsToPlaylist}
        changeListeningHistoryPersistence={changeListeningHistoryPersistence}
        client={client}
        closeContextMenu={closeContextMenu}
        closeFullPlayer={closeFullPlayer}
        contextItems={contextItems}
        contextTarget={contextTarget}
        deletePlaylist={deletePlaylist}
        detailsAlbum={detailsAlbum}
        detailsSong={detailsSong}
        engagementEvents={engagementEvents}
        engagementProfile={engagementProfile}
        engineOpen={engineOpen}
        externalLyricsEnabled={externalLyricsEnabled}
        lyricsBlurEnabled={lyricsBlurEnabled}
        favorite={favorite}
        filteredShortcuts={filteredShortcuts}
        frameMonitor={betaChannel && frameMonitor}
        volumeScrollStep={volumeScrollStep}
        volumeShiftScrollStep={volumeShiftScrollStep}
        fullPlayer={fullPlayer}
        isFavorite={isFavorite}
        listeningEvents={listeningEvents}
        listeningHistoryEnabled={listeningHistoryEnabled}
        listeningHistoryOpen={listeningHistoryOpen}
        listeningHistoryPersistent={listeningHistoryPersistent}
        listeningProfile={listeningProfile}
        modifierLabel={modifierLabel}
        navigate={navigate}
        notice={notice}
        setNotice={setNotice}
        player={player}
        setFullPlayer={setFullPlayer}
        playlistDraft={playlistDraft}
        playlistMutationBusy={playlistMutationBusy}
        playlistPickerSongs={playlistPickerSongs}
        playlistToDelete={playlistToDelete}
        rankerModel={rankerModel}
        recommendationPreviewContext={recommendationPreviewContext}
        recommendationTuning={recommendationTuning}
        recordShortcut={recordShortcut}
        recordingShortcut={recordingShortcut}
        resetLearning={resetLearning}
        resetRecommendationTuning={resetRecommendationTuning}
        resetShortcuts={resetShortcuts}
        savePlaylist={savePlaylist}
        setDetailsAlbum={setDetailsAlbum}
        setDetailsSong={setDetailsSong}
        setEngineOpen={setEngineOpen}
        setListeningHistoryOpen={setListeningHistoryOpen}
        setPlaylistDraft={setPlaylistDraft}
        setPlaylistPickerSongs={setPlaylistPickerSongs}
        setPlaylistToDelete={setPlaylistToDelete}
        setRecordingShortcut={setRecordingShortcut}
        setShortcutQuery={setShortcutQuery}
        setShortcutsOpen={setShortcutsOpen}
        shortcuts={shortcuts}
        shortcutQuery={shortcutQuery}
        shortcutsOpen={shortcutsOpen}
        sidebarPlaylists={sidebarPlaylists}
        updateRecommendationTuning={updateRecommendationTuning}
      />
      {betaChannel && frameMonitor ? <PerformanceOverlay /> : null}
      <ContextMenu
        point={pageContextPoint}
        items={pageContextItems}
        label="Page actions"
        onClose={() => setPageContextPoint(null)}
      />
      </div>
      {scalePreviewOverlay}
    </ArtworkMotionProvider>
  );
}
