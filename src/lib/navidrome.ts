import md5 from "md5";
import {
  lyricsFromStructured,
  parseLrc,
  parsePlainLyrics,
  type Lyrics,
  type StructuredLyrics,
} from "./lyrics";
import type { TrackAnalysis } from "./audio-analysis";
import { localFileUrl } from "./local-file-registry";

export type Song = {
  id: string;
  source?: "navidrome" | "local";
  title: string;
  artist?: string;
  artistId?: string;
  albumArtist?: string;
  composer?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  discNumber?: number;
  /** Server play total, when the OpenSubsonic implementation exposes it. */
  playCount?: number;
  bitRate?: number;
  codec?: string;
  bitDepth?: number;
  samplingRate?: number;
  channelCount?: number;
  suffix?: string;
  contentType?: string;
  starred?: string;
  year?: number;
  genre?: string;
  size?: number;
  /**
   * Scanned tempo in beats per minute, when the server exposes it. Navidrome
   * surfaces this through OpenSubsonic as `bpm`. AutoMix uses it to beat-match.
   */
  bpm?: number;
  /**
   * Scanned musical key, e.g. `Am`, `F#m`, `C major`, or a Camelot code like
   * `8A`. AutoMix converts it to a Camelot wheel position.
   */
  musicalKey?: string;
  /**
   * Tempo/key/energy measured from the audio by AutoMix. Populated lazily for
   * tracks the server has not scanned; see `automix-analyzer.ts`.
   */
  analysis?: TrackAnalysis;
  /** ReplayGain values in dB, when the server exposes scanned tags. */
  replayGain?: {
    trackGain?: number;
    albumGain?: number;
    trackPeak?: number;
    albumPeak?: number;
  };
  /**
   * Server-side file path, e.g. `/Artist/Album/01 - Song.mp3`. Navidrome
   * exposes this on every song and derives its simulated folder tree from it.
   */
  path?: string;
  localPath?: string;
  /** Import-time path used to resolve a local file when the library root is stripped. */
  localFilePath?: string;
  localUrl?: string;
  localArtworkUrl?: string;
  localModified?: number;
};

export type AlbumRecord = {
  id: string;
  /** Per-user server playback count, when supplied. Not global popularity. */
  playCount?: number;
  name?: string;
  title?: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  year?: number;
  genre?: string;
  songCount?: number;
  duration?: number;
  song?: Song[];
  starred?: string;
  created?: string;
  source?: "navidrome" | "local";
  localArtworkUrl?: string;
  localModified?: number;
};

export type Artist = {
  id: string;
  name: string;
  coverArt?: string;
  artistImageUrl?: string;
  albumCount?: number;
  album?: AlbumRecord[];
  starred?: string;
  source?: "navidrome" | "local";
  localArtworkUrl?: string;
  localModified?: number;
};

export type Playlist = {
  id: string;
  name: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  entry?: Song[];
  comment?: string;
  owner?: string;
  public?: boolean;
  readonly?: boolean;
  created?: string;
  changed?: string;
};

export type Credentials = {
  server: string;
  username: string;
  password: string;
  auth?: AuthMaterial;
};
export type AuthMaterial = { salt: string; token: string };
// The parsers live in their own module so they stay testable in isolation.
export { parseLyricsText } from "./lyrics";
export type { Lyrics, LyricsLine, LyricsWord } from "./lyrics";
export type LibraryResults = {
  song: Song[];
  album: AlbumRecord[];
  artist: Artist[];
};
export type Genre = { value: string; songCount?: number; albumCount?: number };

type QueryValue = string | number | boolean;
type Query = Record<string, QueryValue | readonly QueryValue[] | undefined>;
export type SearchOffsets = {
  artistOffset?: number;
  albumOffset?: number;
  songOffset?: number;
};
type Envelope<T> = {
  "subsonic-response"?: T & {
    status?: string;
    error?: { code?: number; message?: string };
  };
};
type LrclibLyricsRecord = {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  duration?: number | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
};

const REQUEST_TIMEOUT = 15_000;
const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";
const LRCLIB_SEARCH_ENDPOINT = "https://lrclib.net/api/search";
const lrclibCache = new Map<string, Lyrics | null>();

export function clearLyricsLookupCache() {
  lrclibCache.clear();
}

const normalizeLrclibValue = (value: string) =>
  value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const lrclibArtistName = (value: string) =>
  value
    .split(/[;\u0000•]/, 1)[0]
    .split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/i, 1)[0]
    .trim();

const lrclibValueMatches = (left: string, right: string) => {
  const a = normalizeLrclibValue(left);
  const b = normalizeLrclibValue(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
};

export function pickSyncedLrclibResult(
  records: unknown,
  song: Song,
): Lyrics | null {
  if (!Array.isArray(records)) return null;
  const title = normalizeLrclibValue(song.title);
  const artist = normalizeLrclibValue(
    lrclibArtistName(song.albumArtist || song.artist || ""),
  );
  const duration = song.duration || 0;
  const candidates = records
    .filter((candidate): candidate is LrclibLyricsRecord => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as LrclibLyricsRecord;
      return (
        lrclibValueMatches(item.trackName || "", title) &&
        lrclibValueMatches(item.artistName || "", artist) &&
        Boolean(item.syncedLyrics && parseLrc(item.syncedLyrics))
      );
    })
    .sort((left, right) => {
      const distance = (item: LrclibLyricsRecord) =>
        typeof item.duration === "number" && duration > 0
          ? Math.abs(item.duration - duration)
          : Number.POSITIVE_INFINITY;
      return distance(left) - distance(right);
    });
  return candidates[0]?.syncedLyrics
    ? parseLrc(candidates[0].syncedLyrics)
    : null;
}

class NavidromeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "NavidromeError";
  }
}

function normalizeServer(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Enter your Navidrome server address.");
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new Error("Enter a valid Navidrome server address.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Your server address must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error(
      "Enter your username and password in the sign-in fields, not the server address.",
    );
  }
  // Accept a pasted REST endpoint while preserving a reverse proxy's base path.
  url.pathname = url.pathname
    .replace(/\/rest(?:\/.*)?$/i, "")
    .replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function serverCandidates(raw: string): string[] {
  const value = raw.trim();
  if (!value) throw new Error("Enter your Navidrome server address.");
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return [normalizeServer(value)];
  }
  return [
    normalizeServer(`https://${value}`),
    normalizeServer(`http://${value}`),
  ];
}

export function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      ["AbortError", "NetworkError", "TimeoutError"].includes(error.name))
  );
}

export type ConnectionIssue = "cors" | "mixed-content" | "network";

/**
 * A failed cross-origin request surfaces as an opaque `TypeError`, which is
 * indistinguishable from an unreachable host. A follow-up `no-cors` probe
 * resolves with an opaque response whenever the origin actually answered, so
 * we can tell "server is up but blocking us with CORS" apart from "we never
 * reached the server" and give the user the right fix.
 */
export async function diagnoseConnection(
  rawServer: string,
  signal?: AbortSignal,
): Promise<ConnectionIssue> {
  const base = rawServer.trim().replace(/\/+$/, "");
  try {
    const target = new URL(base);
    if (
      typeof location !== "undefined" &&
      location.protocol === "https:" &&
      target.protocol === "http:"
    )
      return "mixed-content";
  } catch {
    /* The address is validated elsewhere; fall through to the probe. */
  }
  try {
    await fetch(`${base}/rest/ping.view`, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
    });
    return "cors";
  } catch {
    return "network";
  }
}

const libraryResults = (value?: Partial<LibraryResults>): LibraryResults => ({
  song: value?.song ?? [],
  album: value?.album ?? [],
  artist: value?.artist ?? [],
});

export class Navidrome {
  readonly server: string;
  readonly username: string;
  readonly auth: AuthMaterial;
  private readonly salt: string;
  private readonly token: string;
  private readonly covers = new Map<string, string>();

  constructor(credentials: Credentials) {
    this.server = normalizeServer(credentials.server);
    this.username = credentials.username.trim();
    this.auth = credentials.auth ?? {
      salt: Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
      token: "",
    };
    this.salt = this.auth.salt;
    this.token = this.auth.token || md5(credentials.password + this.salt);
    this.auth.token = this.token;
  }

  private url(endpoint: string, query: Query = {}): string {
    const params = new URLSearchParams({
      u: this.username,
      t: this.token,
      s: this.salt,
      v: "1.16.1",
      c: "VoltaWeb",
      f: "json",
    });
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, String(item)));
      } else {
        params.set(key, String(value));
      }
    }
    return `${this.server}/rest/${endpoint}.view?${params}`;
  }

  private async request<T>(
    endpoint: string,
    query: Query = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            "Navidrome took too long to respond. Try again.",
            "TimeoutError",
          ),
        ),
      REQUEST_TIMEOUT,
    );
    try {
      const response = await fetch(this.url(endpoint, query), {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok)
        throw new NavidromeError(
          `Navidrome returned HTTP ${response.status}.`,
          response.status,
        );
      let payload: Envelope<T>;
      try {
        payload = (await response.json()) as Envelope<T>;
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw new NavidromeError(
          "This address did not return a Navidrome response. Check the server URL.",
        );
      }
      const body = payload?.["subsonic-response"];
      if (!body || body.status !== "ok") {
        throw new NavidromeError(
          body?.error?.message || "Navidrome did not accept this request.",
          undefined,
          body?.error?.code,
        );
      }
      return body;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.request("ping", {}, signal);
  }

  async albums(
    type: string,
    size = 60,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<AlbumRecord[]> {
    const data = await this.request<{ albumList2?: { album?: AlbumRecord[] } }>(
      "getAlbumList2",
      { type, size, offset },
      signal,
    );
    return data.albumList2?.album ?? [];
  }

  async randomSongs(size = 30, signal?: AbortSignal): Promise<Song[]> {
    const data = await this.request<{ randomSongs?: { song?: Song[] } }>(
      "getRandomSongs",
      { size },
      signal,
    );
    return data.randomSongs?.song ?? [];
  }

  async playlists(signal?: AbortSignal): Promise<Playlist[]> {
    const data = await this.request<{ playlists?: { playlist?: Playlist[] } }>(
      "getPlaylists",
      {},
      signal,
    );
    return data.playlists?.playlist ?? [];
  }

  async playlist(id: string, signal?: AbortSignal): Promise<Playlist> {
    const data = await this.request<{ playlist?: Playlist }>(
      "getPlaylist",
      { id },
      signal,
    );
    if (!data.playlist)
      throw new Error("This playlist is no longer available.");
    return { ...data.playlist, entry: data.playlist.entry ?? [] };
  }

  async createPlaylist(
    name: string,
    songIds: string[] = [],
  ): Promise<Playlist | null> {
    const data = await this.request<{ playlist?: Playlist }>(
      "createPlaylist",
      { name, songId: songIds },
    );
    return data.playlist
      ? { ...data.playlist, entry: data.playlist.entry ?? [] }
      : null;
  }

  async updatePlaylist(
    id: string,
    changes: {
      name?: string;
      comment?: string;
      public?: boolean;
      songIdsToAdd?: string[];
      songIndexesToRemove?: number[];
    },
  ): Promise<void> {
    await this.request("updatePlaylist", {
      playlistId: id,
      name: changes.name,
      comment: changes.comment,
      public: changes.public,
      songIdToAdd: changes.songIdsToAdd,
      songIndexToRemove: changes.songIndexesToRemove,
    });
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.request("deletePlaylist", { id });
  }

  async album(id: string, signal?: AbortSignal): Promise<AlbumRecord> {
    const data = await this.request<{ album?: AlbumRecord }>(
      "getAlbum",
      { id },
      signal,
    );
    if (!data.album) throw new Error("This album is no longer available.");
    return { ...data.album, song: data.album.song ?? [] };
  }

  /**
   * Every album in the library, fetched a page at a time.
   *
   * A single `getAlbumList2` call has to be given a size, and OpenSubsonic
   * servers commonly cap that around 500. Anything that needs the whole
   * collection (retrieval for recommendations, Infinite Play) has to paginate,
   * otherwise it silently treats the first page as the entire library and can
   * never surface albums past it.
   */
  async allAlbums(
    options: {
      type?: string;
      pageSize?: number;
      max?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<AlbumRecord[]> {
    const type = options.type || "alphabeticalByName";
    const pageSize = Math.max(1, Math.trunc(options.pageSize ?? 500));
    const max = options.max && options.max > 0 ? Math.trunc(options.max) : Infinity;
    const albums = new Map<string, AlbumRecord>();
    for (let offset = 0; albums.size < max; offset += pageSize) {
      const page = await this.albums(type, pageSize, offset, options.signal);
      if (!page.length) break;
      let added = 0;
      for (const album of page) {
        const id = album.id?.trim();
        // Paged endpoints can repeat rows near a boundary; keying by ID both
        // dedupes and gives a reliable termination signal.
        if (!id || albums.has(id)) continue;
        albums.set(id, album);
        added += 1;
      }
      // A full page that added nothing new means the server is ignoring the
      // offset. Stop rather than looping forever.
      if (!added) break;
      if (page.length < pageSize) break;
    }
    return [...albums.values()].slice(0, max);
  }

  /** Full metadata for one track, used to hydrate locally recorded history. */
  async song(id: string, signal?: AbortSignal): Promise<Song> {
    const data = await this.request<{ song?: Song }>(
      "getSong",
      { id },
      signal,
    );
    if (!data.song) throw new Error("This song is no longer available.");
    return data.song;
  }

  async artists(signal?: AbortSignal): Promise<Artist[]> {
    const data = await this.request<{
      artists?: { index?: { artist?: Artist[] }[] };
    }>("getArtists", {}, signal);
    return data.artists?.index?.flatMap((index) => index.artist ?? []) ?? [];
  }

  async artist(id: string, signal?: AbortSignal): Promise<Artist> {
    const data = await this.request<{ artist?: Artist }>(
      "getArtist",
      { id },
      signal,
    );
    if (!data.artist) throw new Error("This artist is no longer available.");
    return { ...data.artist, album: data.artist.album ?? [] };
  }

  async search(
    query: string,
    offsets: SearchOffsets = {},
    signal?: AbortSignal,
  ): Promise<LibraryResults> {
    const data = await this.request<{
      searchResult3?: Partial<LibraryResults>;
    }>(
      "search3",
      {
        query,
        artistCount: 30,
        artistOffset: offsets.artistOffset ?? 0,
        albumCount: 50,
        albumOffset: offsets.albumOffset ?? 0,
        songCount: 100,
        songOffset: offsets.songOffset ?? 0,
      },
      signal,
    );
    return libraryResults(data.searchResult3);
  }

  async songs(offset = 0, size = 100, signal?: AbortSignal): Promise<Song[]> {
    // OpenSubsonic specifies an empty query for complete, paginated library access.
    const data = await this.request<{ searchResult3?: { song?: Song[] } }>(
      "search3",
      {
        query: "",
        artistCount: 0,
        albumCount: 0,
        songCount: size,
        songOffset: offset,
      },
      signal,
    );
    return data.searchResult3?.song ?? [];
  }

  /**
   * Every song in the library, paginated.
   *
   * Servers clamp `songCount` (Navidrome caps it near 100), so the page size is
   * only a request. Advancing by what the server actually returned — and
   * treating a short page as the end — is what keeps a large library from being
   * silently truncated to its first page.
   */
  async allSongs(
    options: { pageSize?: number; max?: number; signal?: AbortSignal } = {},
  ): Promise<Song[]> {
    const pageSize = Math.max(1, Math.trunc(options.pageSize ?? 100));
    const max = options.max && options.max > 0 ? Math.trunc(options.max) : Infinity;
    const songs = new Map<string, Song>();
    let offset = 0;
    while (songs.size < max) {
      const page = await this.songs(offset, pageSize, options.signal);
      if (!page.length) break;
      let added = 0;
      for (const song of page) {
        const id = song.id?.trim();
        // Paged endpoints can repeat rows near a boundary; keying by ID both
        // dedupes and gives a reliable termination signal.
        if (!id || songs.has(id)) continue;
        songs.set(id, song);
        added += 1;
      }
      // A full page that added nothing new means the server is ignoring the
      // offset. Stop rather than looping forever.
      if (!added) break;
      offset += page.length;
      if (page.length < pageSize) break;
    }
    return [...songs.values()].slice(0, max);
  }

  async favorites(signal?: AbortSignal): Promise<LibraryResults> {
    const data = await this.request<{ starred2?: Partial<LibraryResults> }>(
      "getStarred2",
      {},
      signal,
    );
    return libraryResults(data.starred2);
  }

  async genres(signal?: AbortSignal): Promise<Genre[]> {
    const data = await this.request<{ genres?: { genre?: Genre[] } }>(
      "getGenres",
      {},
      signal,
    );
    return data.genres?.genre ?? [];
  }

  async songsByGenre(genre: string, offset = 0, count = 100, signal?: AbortSignal): Promise<Song[]> {
    const data = await this.request<{ songsByGenre?: { song?: Song[] } }>(
      "getSongsByGenre", { genre, offset, count }, signal,
    );
    return data.songsByGenre?.song ?? [];
  }

  async lyrics(song: Song, signal?: AbortSignal): Promise<Lyrics | null> {
    const structured = await this.structuredLyrics(song, signal);
    if (structured) return structured;
    try {
      const data = await this.request<{ lyrics?: { value?: string } }>(
        "getLyrics",
        { artist: song.artist, title: song.title },
        signal,
      );
      return parsePlainLyrics(data.lyrics?.value || "");
    } catch (error) {
      // A missing legacy lyrics endpoint or an unrecognized song should still
      // allow the external fallback to run.
      if (isConnectionFailure(error) || error instanceof NavidromeError)
        return null;
      throw error;
    }
  }

  /**
   * OpenSubsonic `songLyrics` v2, which is where word-level timing, vocal
   * attribution and translation tracks live. Servers older than that reject
   * the `enhanced` parameter, so the request is retried without it, and a
   * server with no such endpoint at all reports null so the caller can fall
   * back to the legacy plain-lyrics endpoint.
   */
  private async structuredLyrics(
    song: Song,
    signal?: AbortSignal,
  ): Promise<Lyrics | null> {
    for (const enhanced of [true, false]) {
      try {
        const data = await this.request<{
          lyricsList?: { structuredLyrics?: StructuredLyrics[] };
        }>(
          "getLyricsBySongId",
          enhanced ? { id: song.id, enhanced: true } : { id: song.id },
          signal,
        );
        const lyrics = lyricsFromStructured(data.lyricsList?.structuredLyrics);
        return lyrics?.lines.length ? lyrics : null;
      } catch (error) {
        // Cancellation and connectivity errors skip straight to the external
        // fallback rather than starting a second request.
        if (isConnectionFailure(error)) return null;
        if (!(error instanceof NavidromeError)) throw error;
        if (
          [404, 405, 501].includes(error.status ?? -1) ||
          [0, 20, 70].includes(error.code ?? -1)
        )
          return null;
        // Anything else may simply be a server that does not know `enhanced`,
        // so the plain request is worth one attempt.
        if (!enhanced) return null;
      }
    }
    return null;
  }

  async lrclibLyrics(
    song: Song,
    signal?: AbortSignal,
  ): Promise<Lyrics | null> {
    if (!song.title || !song.artist) return null;
    const cacheKey = [
      song.title,
      song.artist,
      song.album || "",
      song.duration || "",
    ].join("\u001f");
    if (lrclibCache.has(cacheKey)) return lrclibCache.get(cacheKey) ?? null;
    // LRCLIB indexes collaborations under the album's primary artist. Keep
    // the track artist for display, but use albumArtist when the server gives
    // us one so multi-artist tags do not make the lookup too specific.
    const artistName = lrclibArtistName(song.albumArtist || song.artist);
    const query = new URLSearchParams({
      track_name: song.title,
      artist_name: artistName,
    });
    if (song.album) query.set("album_name", song.album);
    if (song.duration && song.duration > 0 && song.duration <= 3600)
      query.set("duration", String(Math.round(song.duration)));

    // Search returns the available alternatives. Prefer the synced candidate
    // whose duration is closest to the user's track before using /api/get.
    const searchQuery = new URLSearchParams({
      track_name: song.title,
      artist_name: artistName,
    });
    try {
      const searchResponse = await fetch(
        `${LRCLIB_SEARCH_ENDPOINT}?${searchQuery}`,
        {
          signal,
          credentials: "omit",
          headers: { "Lrclib-Client": "Volta Web Player" },
          referrerPolicy: "no-referrer",
        },
      );
      if (searchResponse.ok) {
        const syncedLyrics = pickSyncedLrclibResult(
          await searchResponse.json(),
          song,
        );
        if (syncedLyrics) {
          lrclibCache.set(cacheKey, syncedLyrics);
          return syncedLyrics;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // Let the precise /api/get fallback try before giving up.
    }

    let response: Response;
    try {
      response = await fetch(`${LRCLIB_ENDPOINT}?${query}`, {
        signal,
        credentials: "omit",
        headers: { "Lrclib-Client": "Volta Web Player" },
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    const hasGetRecord = response.status !== 404;
    if (hasGetRecord && !response.ok) return null;

    let record: LrclibLyricsRecord | null = null;
    if (hasGetRecord) {
      try {
        record = (await response.json()) as LrclibLyricsRecord;
      } catch {
        return null;
      }
    }

    const lyrics =
      (record?.syncedLyrics && parseLrc(record.syncedLyrics)) ||
      (record?.plainLyrics && parsePlainLyrics(record.plainLyrics)) ||
      null;
    // Do not cache misses: rate limits and temporary provider failures should
    // not make a track appear permanently lyric-less for this browser session.
    if (lyrics) lrclibCache.set(cacheKey, lyrics);
    return lyrics;
  }

  /** active is the song's current favorite state; true removes the favorite. */
  async star(song: Song, active: boolean): Promise<void> {
    await this.request(active ? "unstar" : "star", { id: song.id });
  }

  /** Favorites are supported for albums and artists as well as songs. */
  async starAlbum(id: string, active: boolean): Promise<void> {
    await this.request(active ? "unstar" : "star", { albumId: id });
  }

  async starArtist(id: string, active: boolean): Promise<void> {
    await this.request(active ? "unstar" : "star", { artistId: id });
  }

  async scrobble(song: Song, submission = false): Promise<void> {
    await this.request("scrobble", { id: song.id, submission });
  }

  stream(song: Song, original: boolean): string {
    if (song.source === "local") {
      // Resolved on demand so a scan does not mint a blob URL per track.
      const url = song.localUrl || localFileUrl(song.localFilePath || song.localPath);
      if (url) return url;
    }
    return this.url("stream", {
      id: song.id,
      format: original ? "raw" : "mp3",
      maxBitRate: original ? undefined : 320,
    });
  }

  cover(id?: string, size?: number): string | undefined {
    if (!id) return undefined;
    const key = `${id}:${size ?? "original"}`;
    let url = this.covers.get(key);
    if (!url) {
      url = this.url("getCoverArt", { id, size });
      this.covers.set(key, url);
    }
    return url;
  }
}

export function isLocalSong(song?: Song): boolean {
  return song?.source === "local" || Boolean(song?.localUrl);
}

export function duration(seconds?: number): string {
  const value = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds!))
    : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

const normalizeLocalAlbumLabel = (value: string) =>
  value
    .normalize("NFKD")
    .toLocaleLowerCase()
    // A dollar sign is often stylized as an S in artist names, such as
    // `$uicideBoy$` and `SuicideBoy$`.
    .replace(/\$/g, "s")
    .replace(/[^\p{L}\p{N}]+/gu, "");

export const localAlbumName = (album: string, artist?: string) => {
  const value = album.trim();
  const normalizedArtist = normalizeLocalAlbumLabel(artist || "");
  if (!value || !normalizedArtist) return value;

  const stripOneArtistPrefix = (current: string) => {
    // A dash only splits a prefix when it is separated by whitespace, so an
    // artist such as Jay-Z remains intact. Semicolons and colons are common in
    // copied music-folder names and may be adjacent to the artist.
    const match = current.match(
      /^(.*?)(?:\s+[-–—]\s*|\s*[:;|]\s*)(.+)$/,
    );
    if (!match || normalizeLocalAlbumLabel(match[1]) !== normalizedArtist)
      return current;
    return match[2].trim() || current;
  };

  let result = value;
  for (let pass = 0; pass < 4; pass++) {
    const stripped = stripOneArtistPrefix(result);
    if (stripped === result) break;
    result = stripped;
  }
  return result;
};

export const albumName = (album: AlbumRecord): string => {
  return album.name || album.title || "Untitled album";
};

/** Source metadata only; this does not promise a bit-perfect hardware output path. */
export function isLossless(song?: Song): boolean {
  const extension = song?.suffix?.toLowerCase().replace(/^\./, "");
  const codec = song?.codec?.toLowerCase().trim();
  const contentType = song?.contentType?.toLowerCase().split(";", 1)[0].trim();
  // Navidrome can describe ALAC in an M4A container without exposing the
  // codec name. A populated bit-depth field is its lossless precision signal;
  // ordinary AAC/M4A entries do not carry that field.
  const losslessM4a =
    ["m4a", "mp4"].includes(extension ?? "") &&
    Number.isFinite(song?.bitDepth) &&
    (song?.bitDepth ?? 0) > 0;
  return (
    ["alac", "flac", "wav", "wave", "aif", "aiff"].includes(codec ?? "") ||
    ["flac", "alac", "wav", "wave", "aif", "aiff"].includes(extension ?? "") ||
    losslessM4a ||
    [
      "audio/flac",
      "audio/x-flac",
      "audio/alac",
      "audio/x-alac",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/vnd.wave",
      "audio/aiff",
      "audio/x-aiff",
    ].includes(contentType ?? "")
  );
}

/** Linear gain for a ReplayGain value in dB, limited so peaks cannot clip. */
export function replayGainFactor(
  song: Song | undefined,
  mode: "off" | "track" | "album",
): number {
  if (!song || mode === "off") return 1;
  const gain =
    mode === "track" ? song.replayGain?.trackGain : song.replayGain?.albumGain;
  const peak =
    mode === "track" ? song.replayGain?.trackPeak : song.replayGain?.albumPeak;
  if (!Number.isFinite(gain) || !gain) return 1;
  let factor = Math.pow(10, (gain as number) / 20);
  // ReplayGain targets a reference loudness; a positive peak above full scale
  // would clip, so scale back to the loudest safe value.
  if (Number.isFinite(peak) && (peak as number) * factor > 1)
    factor = 1 / (peak as number);
  return Math.max(0, Math.min(4, factor));
}

export function shuffleSongs(songs: readonly Song[]): Song[] {
  const result = [...songs];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
