import md5 from "md5";

export type Song = {
  id: string;
  source?: "navidrome" | "local";
  title: string;
  artist?: string;
  artistId?: string;
  albumArtist?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  discNumber?: number;
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
  localPath?: string;
  localUrl?: string;
  localArtworkUrl?: string;
  localModified?: number;
};

export type AlbumRecord = {
  id: string;
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
/** start is in seconds, with the server's lyric offset already applied. */
export type LyricsLine = { text: string; start?: number };
export type Lyrics = {
  lines: LyricsLine[];
  synced: boolean;
  language?: string;
};
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
type StructuredLyrics = {
  lang?: string;
  offset?: number;
  synced: boolean;
  line?: { value: string; start?: number }[];
};

type LrclibLyricsRecord = {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
};

const REQUEST_TIMEOUT = 15_000;
const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";
const lrclibCache = new Map<string, Lyrics | null>();

function parseLrc(value: string): Lyrics | null {
  const lines: LyricsLine[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const timestamps = [
      ...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g),
    ];
    if (!timestamps.length) continue;
    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    for (const timestamp of timestamps) {
      const fraction = (timestamp[3] || "").padEnd(3, "0").slice(0, 3);
      lines.push({
        text,
        start:
          Number(timestamp[1]) * 60 +
          Number(timestamp[2]) +
          (fraction ? Number(fraction) / 1000 : 0),
      });
    }
  }
  if (!lines.length) return null;
  lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return { lines, synced: true };
}

function parsePlainLyrics(value: string): Lyrics | null {
  if (!value.trim()) return null;
  return {
    synced: false,
    lines: value.split(/\r?\n/).map((text) => ({ text })),
  };
}

export function parseLyricsText(value: string): Lyrics | null {
  return parseLrc(value) || parsePlainLyrics(value);
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
    try {
      const data = await this.request<{
        lyricsList?: { structuredLyrics?: StructuredLyrics[] };
      }>("getLyricsBySongId", { id: song.id }, signal);
      const options =
        data.lyricsList?.structuredLyrics?.filter(
          (option) => option.line?.length,
        ) ?? [];
      const lyrics = options.find((option) => option.synced) ?? options[0];
      if (lyrics?.line) {
        // OpenSubsonic positive offsets display lyrics sooner, so subtract them.
        const offset = Number.isFinite(lyrics.offset) ? lyrics.offset! : 0;
        const lines = lyrics.line.map((line) => ({
          text: line.value,
          start:
            lyrics.synced &&
            typeof line.start === "number" &&
            Number.isFinite(line.start)
              ? Math.max(0, (line.start - offset) / 1000)
              : undefined,
        }));
        return {
          lines,
          synced:
            lyrics.synced && lines.some((line) => line.start !== undefined),
          language:
            lyrics.lang === "und" || lyrics.lang === "xxx"
              ? undefined
              : lyrics.lang,
        };
      }
    } catch (error) {
      // Older servers can lack this extension. Cancellation and connectivity errors
      // skip directly to the external fallback instead of starting a second request.
      if (isConnectionFailure(error)) return null;
      if (!(error instanceof NavidromeError)) throw error;
      if (
        !(
          [404, 405, 501].includes(error.status ?? -1) ||
          [0, 20, 70].includes(error.code ?? -1)
        )
      )
        return null;
    }
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
    const query = new URLSearchParams({
      track_name: song.title,
      artist_name: song.artist,
    });
    if (song.album) query.set("album_name", song.album);
    if (song.duration && song.duration > 0 && song.duration <= 3600)
      query.set("duration", String(Math.round(song.duration)));

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
    if (response.status === 404) {
      lrclibCache.set(cacheKey, null);
      return null;
    }
    if (!response.ok) return null;

    let record: LrclibLyricsRecord;
    try {
      record = (await response.json()) as LrclibLyricsRecord;
    } catch {
      return null;
    }
    const syncedLyrics = record.syncedLyrics
      ? parseLrc(record.syncedLyrics)
      : null;
    const lyrics =
      syncedLyrics ||
      (record.plainLyrics && parsePlainLyrics(record.plainLyrics)) ||
      null;
    lrclibCache.set(cacheKey, lyrics);
    return lyrics;
  }

  /** active is the song's current favorite state; true removes the favorite. */
  async star(song: Song, active: boolean): Promise<void> {
    await this.request(active ? "unstar" : "star", { id: song.id });
  }

  async scrobble(song: Song, submission = false): Promise<void> {
    await this.request("scrobble", { id: song.id, submission });
  }

  stream(song: Song, original: boolean): string {
    if (song.source === "local" && song.localUrl) return song.localUrl;
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

export function shuffleSongs(songs: readonly Song[]): Song[] {
  const result = [...songs];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
