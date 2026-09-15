import {
  type AlbumRecord,
  type Artist,
  type Song,
} from "./navidrome";
import { discardArtworkStill } from "./artwork";

const LOCAL_MUSIC_DB = "volta-local-music";
const LOCAL_MUSIC_STORE = "settings";
const LOCAL_MUSIC_HANDLE_KEY = "music-directory";

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "alac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "wave",
  "weba",
  "wma",
]);
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
const PREFERRED_ARTWORK_NAMES = new Map([
  ["cover", 100],
  ["folder", 95],
  ["front", 90],
  ["album", 85],
  ["artwork", 80],
  ["artist", 75],
]);

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<LocalDirectoryHandle>;
};

type LocalFileHandle = FileSystemFileHandle & { kind: "file" };
type LocalDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle>;
  queryPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

export type LocalMusicLibrary = {
  directoryName: string;
  tracks: Song[];
  albums: AlbumRecord[];
  recentAlbums: AlbumRecord[];
  artists: Artist[];
  artworkUrls: string[];
  source: "directory" | "files";
};

export const supportsDirectoryPicker = () =>
  typeof window !== "undefined" &&
  typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";

export const isSupportedAudioFile = (fileName: string) => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return Boolean(extension && AUDIO_EXTENSIONS.has(extension));
};

const isSupportedImageFile = (fileName: string) => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return Boolean(extension && IMAGE_EXTENSIONS.has(extension));
};

const pathDirectory = (path: string) =>
  path.split(/[\\/]/).slice(0, -1).join("/");

const normalizedStem = (path: string) => {
  const filename = path.split(/[\\/]/).filter(Boolean).at(-1) || "";
  return filename.replace(/\.[^.]+$/, "").trim().toLowerCase();
};

type LocalFileEntry = { file: File; path: string };
type LocalArtwork = { path: string; url: string; directory: string; stem: string };
type ParsedMetadata = {
  title?: string;
  artist?: string;
  albumArtist?: string;
  composer?: string;
  album?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  codec?: string;
  bitDepth?: number;
  samplingRate?: number;
  artwork?: Blob;
};
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const METADATA_READERS = 4;

const textDecoder = (encoding: "utf-8" | "utf-16le" | "utf-16be") =>
  new TextDecoder(encoding);

const cleanText = (value: string) => value.replace(/\0/g, "").trim();

const decodeBytes = (bytes: Uint8Array, encoding: number) => {
  try {
    return cleanText(
      textDecoder(
        encoding === 1 ? "utf-16le" : encoding === 2 ? "utf-16be" : "utf-8",
      ).decode(bytes),
    );
  } catch {
    return cleanText(new TextDecoder().decode(bytes));
  }
};

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

const bigEndian32 = (bytes: Uint8Array, offset: number) =>
  (((bytes[offset] || 0) << 24) |
    ((bytes[offset + 1] || 0) << 16) |
    ((bytes[offset + 2] || 0) << 8) |
    (bytes[offset + 3] || 0)) >>> 0;

const bigEndian16 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);

const littleEndian32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] || 0) |
    ((bytes[offset + 1] || 0) << 8) |
    ((bytes[offset + 2] || 0) << 16) |
    ((bytes[offset + 3] || 0) << 24)) >>> 0;

const syncSafe32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] || 0) << 21) |
  ((bytes[offset + 1] || 0) << 14) |
  ((bytes[offset + 2] || 0) << 7) |
  (bytes[offset + 3] || 0);

const splitTrack = (value: string) => {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : undefined;
};

const metadataField = (metadata: ParsedMetadata, key: string, value: string) => {
  const clean = cleanText(value);
  if (!clean) return;
  if (key === "title") metadata.title = clean;
  else if (key === "artist")
    metadata.artist = metadata.artist
      ? `${metadata.artist}; ${clean}`
      : clean;
  else if (key === "albumartist" || key === "album artist") metadata.albumArtist = clean;
  else if (key === "composer" || key === "writer")
    metadata.composer = metadata.composer
      ? `${metadata.composer}; ${clean}`
      : clean;
  else if (key === "album") metadata.album = clean;
  else if (key === "track") metadata.track = splitTrack(clean);
  else if (key === "disc" || key === "discnumber" || key === "disc number")
    metadata.discNumber = splitTrack(clean);
  else if (key === "year") {
    const year = Number(clean.slice(0, 4));
    if (Number.isFinite(year) && year > 0) metadata.year = year;
  } else if (key === "genre") metadata.genre = clean;
};

const parseId3 = (bytes: Uint8Array): ParsedMetadata => {
  const metadata: ParsedMetadata = {};
  const version = bytes[3] || 3;
  const tagEnd = Math.min(bytes.length, 10 + syncSafe32(bytes, 6));
  let offset = 10;
  if (bytes[5] & 0x40) {
    const extendedSize =
      version >= 4 ? syncSafe32(bytes, offset) : bigEndian32(bytes, offset);
    offset += 4 + extendedSize;
  }
  const fields: Record<string, string> = {
    TIT2: "title",
    TPE1: "artist",
    TPE2: "albumartist",
    TCOM: "composer",
    TALB: "album",
    TRCK: "track",
    TPOS: "discnumber",
    TDRC: "year",
    TYER: "year",
    TCON: "genre",
  };
  while (offset + 10 <= tagEnd) {
    const id = ascii(bytes, offset, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size =
      version >= 4 ? syncSafe32(bytes, offset + 4) : bigEndian32(bytes, offset + 4);
    if (!size || offset + 10 + size > tagEnd) break;
    const frame = bytes.slice(offset + 10, offset + 10 + size);
    const field = fields[id];
    if (field && frame.length > 1) metadataField(metadata, field, decodeBytes(frame.slice(1), frame[0]));
    if (id === "APIC" && frame.length > 4) {
      const encoding = frame[0];
      let cursor = 1;
      while (cursor < frame.length && frame[cursor] !== 0) cursor++;
      const mime = new TextDecoder().decode(frame.slice(1, cursor)) || "image/jpeg";
      cursor += 2;
      if (cursor < frame.length) {
        cursor++;
        while (
          cursor < frame.length &&
          (encoding === 1 || encoding === 2
            ? frame[cursor] !== 0 || frame[cursor + 1] !== 0
            : frame[cursor] !== 0)
        )
          cursor += encoding === 1 || encoding === 2 ? 2 : 1;
        cursor += encoding === 1 || encoding === 2 ? 2 : 1;
        if (cursor < frame.length)
          metadata.artwork = new Blob([frame.slice(cursor)], { type: mime });
      }
    }
    offset += 10 + size;
  }
  return metadata;
};

const parseFlac = (bytes: Uint8Array): ParsedMetadata => {
  const metadata: ParsedMetadata = {};
  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const type = header & 0x7f;
    const length =
      ((bytes[offset + 1] || 0) << 16) |
      ((bytes[offset + 2] || 0) << 8) |
      (bytes[offset + 3] || 0);
    const start = offset + 4;
    const end = start + length;
    if (end > bytes.length) break;
    const block = bytes.slice(start, end);
    if (type === 4 && block.length >= 8) {
      let cursor = 4 + littleEndian32(block, 0);
      const count = littleEndian32(block, cursor);
      cursor += 4;
      for (let index = 0; index < count && cursor + 4 <= block.length; index++) {
        const size = littleEndian32(block, cursor);
        cursor += 4;
        const value = new TextDecoder().decode(block.slice(cursor, cursor + size));
        cursor += size;
        const separator = value.indexOf("=");
        if (separator > 0)
          metadataField(
            metadata,
            value.slice(0, separator).toLowerCase(),
            value.slice(separator + 1),
          );
      }
    } else if (type === 6 && block.length >= 32) {
      let cursor = 4;
      const mimeLength = bigEndian32(block, cursor);
      cursor += 4 + mimeLength;
      const descriptionLength = bigEndian32(block, cursor);
      cursor += 4 + descriptionLength + 16;
      if (cursor + 4 <= block.length) {
        const imageLength = bigEndian32(block, cursor);
        const imageStart = cursor + 4;
        if (imageStart + imageLength <= block.length) {
          const mimeStart = 8;
          const mime = new TextDecoder().decode(
            block.slice(mimeStart, mimeStart + mimeLength),
          );
          metadata.artwork = new Blob([block.slice(imageStart, imageStart + imageLength)], {
            type: mime || "image/jpeg",
          });
        }
      }
    }
    offset = end;
    if (header & 0x80) break;
  }
  return metadata;
};

const parseMp4 = (bytes: Uint8Array): ParsedMetadata => {
  const metadata: ParsedMetadata = {};
  const parseBoxes = (start: number, end: number, container = "") => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = bigEndian32(bytes, offset);
      const type = ascii(bytes, offset + 4, 4);
      const boxEnd = Math.min(end, offset + (size || end - offset));
      if (boxEnd <= offset + 8) break;
      const payload = offset + 8 + (type === "meta" ? 4 : 0);
      if (["moov", "trak", "mdia", "minf", "stbl", "udta", "meta", "ilst"].includes(type))
        parseBoxes(payload, boxEnd, type);
      else if (type === "stsd" && payload + 4 <= boxEnd) {
        const entryCount = bigEndian32(bytes, payload + 4);
        let entry = payload + 8;
        for (let index = 0; index < entryCount && entry + 8 <= boxEnd; index++) {
          const entrySize = bigEndian32(bytes, entry);
          const entryEnd = Math.min(boxEnd, entry + entrySize);
          if (entrySize < 8 || entryEnd <= entry) break;
          const codec = ascii(bytes, entry + 4, 4).toLowerCase();
          if (codec === "alac") {
            metadata.codec = "alac";
            if (entrySize >= 36) {
              metadata.bitDepth = bigEndian16(bytes, entry + 26);
              metadata.samplingRate = bigEndian32(bytes, entry + 32) >>> 16;
            }
          }
          entry = entryEnd;
        }
      }
      else if (container === "ilst") {
        let child = payload;
        while (child + 8 <= boxEnd) {
          const childSize = bigEndian32(bytes, child);
          const childType = ascii(bytes, child + 4, 4);
          const childEnd = Math.min(boxEnd, child + (childSize || boxEnd - child));
          if (childEnd <= child + 8) break;
          if (childType === "data" && childEnd >= child + 16) {
            const flags = bigEndian32(bytes, child + 8);
            const value = bytes.slice(child + 16, childEnd);
            if (type === "©nam") metadataField(metadata, "title", new TextDecoder().decode(value));
            else if (type === "©ART")
              metadataField(metadata, "artist", new TextDecoder().decode(value));
            else if (type === "aART")
              metadataField(metadata, "albumartist", new TextDecoder().decode(value));
            else if (type === "©wrt")
              metadataField(metadata, "composer", new TextDecoder().decode(value));
            else if (type === "©alb") metadataField(metadata, "album", new TextDecoder().decode(value));
            else if (type === "©day") metadataField(metadata, "year", new TextDecoder().decode(value));
            else if (type === "©gen") metadataField(metadata, "genre", new TextDecoder().decode(value));
            else if (type === "trkn" && value.length >= 4)
              metadata.track = (value[2] << 8) | value[3];
            else if (type === "disk" && value.length >= 4)
              metadata.discNumber = (value[2] << 8) | value[3];
            else if (type === "covr")
              metadata.artwork = new Blob([value], {
                type: flags === 14 ? "image/png" : "image/jpeg",
              });
          }
          child = childEnd;
        }
      }
      offset = boxEnd;
    }
  };
  parseBoxes(0, bytes.length);
  return metadata;
};

const findMp4Box = (bytes: Uint8Array, wanted: string) => {
  for (let offset = 4; offset + 8 <= bytes.length; offset++) {
    if (ascii(bytes, offset, 4) !== wanted) continue;
    const start = offset - 4;
    const size = bigEndian32(bytes, start);
    if (size >= 8 && start + size <= bytes.length)
      return bytes.slice(start, start + size);
  }
  return null;
};

const mergeMetadata = (first: ParsedMetadata, second: ParsedMetadata) => ({
  ...first,
  ...second,
  title: first.title || second.title,
  artist: first.artist || second.artist,
  albumArtist: first.albumArtist || second.albumArtist,
  composer: first.composer || second.composer,
  album: first.album || second.album,
  track: first.track || second.track,
  discNumber: first.discNumber || second.discNumber,
  year: first.year || second.year,
  genre: first.genre || second.genre,
  codec: first.codec || second.codec,
  bitDepth: first.bitDepth || second.bitDepth,
  samplingRate: first.samplingRate || second.samplingRate,
  artwork: first.artwork || second.artwork,
});

const readAudioMetadata = async (file: File): Promise<ParsedMetadata> => {
  try {
    const bytes = new Uint8Array(
      await file.slice(0, MAX_METADATA_BYTES).arrayBuffer(),
    );
    if (ascii(bytes, 0, 3) === "ID3") return parseId3(bytes);
    if (ascii(bytes, 0, 4) === "fLaC") return parseFlac(bytes);
    if (ascii(bytes, 4, 4) === "ftyp") {
      const head = parseMp4(bytes);
      if (file.size <= MAX_METADATA_BYTES || head.artwork) return head;
      const tailStart = Math.max(0, file.size - MAX_METADATA_BYTES);
      const tail = new Uint8Array(
        await file.slice(tailStart, file.size).arrayBuffer(),
      );
      const moov = findMp4Box(tail, "moov");
      return moov ? mergeMetadata(head, parseMp4(moov)) : head;
    }
  } catch {
    /* Metadata is optional; the filename remains a display-only fallback. */
  }
  return {};
};

const readAudioMetadataBatch = async (files: LocalFileEntry[]) => {
  const metadata: ParsedMetadata[] = Array.from(
    { length: files.length },
    () => ({}),
  );
  let nextIndex = 0;
  const readNext = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++;
      metadata[index] = await readAudioMetadata(files[index].file);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(METADATA_READERS, files.length) },
      () => readNext(),
    ),
  );
  return metadata;
};

const filePath = (file: File) =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
  file.name;

const trackFromFile = (
  file: File,
  relativePath: string,
  metadata: ParsedMetadata = {},
  rootName = "",
): Song => {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const libraryParts = rootName && parts[0] === rootName ? parts.slice(1) : parts;
  const stablePath = libraryParts.join("/");
  const filename = parts.at(-1) || file.name;
  const stem = filename.replace(/\.[^.]+$/, "");
  const extension = filename.split(".").pop()?.toLowerCase();

  return {
    id: `local:${stablePath}`,
    source: "local",
    // Embedded tags are authoritative. The filename is only a last-resort
    // display label when a file is genuinely missing a title tag; folders
    // never become artist, album, or track metadata.
    title: metadata.title || stem.trim() || "Untitled track",
    artist: metadata.artist,
    albumArtist: metadata.albumArtist,
    composer: metadata.composer,
    album: metadata.album,
    track: metadata.track,
    discNumber: metadata.discNumber,
    year: metadata.year,
    genre: metadata.genre,
    codec: metadata.codec,
    bitDepth: metadata.bitDepth,
    samplingRate: metadata.samplingRate,
    suffix: extension,
    contentType: file.type || undefined,
    size: file.size,
    localModified: file.lastModified,
    localPath: relativePath,
    localUrl: URL.createObjectURL(file),
  };
};

const metadataOrder = (value?: number) =>
  Number.isFinite(value) ? value! : Number.MAX_SAFE_INTEGER;

const compareMetadataTracks = (left: Song, right: Song) =>
  metadataOrder(left.discNumber) - metadataOrder(right.discNumber) ||
  metadataOrder(left.track) - metadataOrder(right.track) ||
  left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
  (left.localPath || "").localeCompare(right.localPath || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });

const metadataKey = (value: string) =>
  value.normalize("NFKD").toLocaleLowerCase().trim();
const localArtistId = (name: string) => `local-artist:${metadataKey(name)}`;
const localAlbumId = (artist: string, album: string) =>
  `local-album:${metadataKey(artist)}\u001f${metadataKey(album)}`;

const preferredArtwork = (
  artwork: LocalArtwork[],
  directory: string,
  fallback?: string,
) => {
  const candidates = artwork
    .filter((item) => item.directory === directory)
    .sort(
      (left, right) =>
        (PREFERRED_ARTWORK_NAMES.get(left.stem) || 0) -
          (PREFERRED_ARTWORK_NAMES.get(right.stem) || 0) ||
        left.path.localeCompare(right.path, undefined, { sensitivity: "base" }),
    );
  return candidates.at(-1)?.url || fallback;
};

const artistDirectory = (path: string, rootName = "") => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const libraryParts = rootName && parts[0] === rootName ? parts.slice(1) : parts;
  const folderCount = Math.max(0, libraryParts.length - 1);
  return folderCount >= 2
    ? parts.slice(0, -2).join("/")
    : folderCount === 1
      ? parts.slice(0, -1).join("/")
      : "";
};

const libraryFromFiles = async (
  files: LocalFileEntry[],
  directoryName: string,
  source: LocalMusicLibrary["source"],
): Promise<LocalMusicLibrary> => {
  const audioFiles = files
    .filter(({ file, path }) => isSupportedAudioFile(path || file.name))
    .sort((left, right) =>
      left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const artwork = files
    .filter(({ file, path }) => isSupportedImageFile(path || file.name))
    .map(({ file, path }): LocalArtwork => ({
      path,
      url: URL.createObjectURL(file),
      directory: pathDirectory(path),
      stem: normalizedStem(path),
    }));
  const metadata = await readAudioMetadataBatch(audioFiles);
  const embeddedArtwork = metadata.map((item) =>
    item.artwork ? URL.createObjectURL(item.artwork) : undefined,
  );
  const artworkUrls = [
    ...artwork.map((item) => item.url),
    ...embeddedArtwork.filter((url): url is string => Boolean(url)),
  ];
  const sameStemArtwork = new Map(
    artwork.map((item) => [`${item.directory}\u001f${item.stem}`, item.url]),
  );
  const albumArtwork = new Map<string, string>();
  const artistArtwork = new Map<string, string>();
  const albumsById = new Map<string, AlbumRecord>();
  const artistsById = new Map<string, Artist>();
  const trackEntries = audioFiles
    .map(({ file, path }, index) => ({
      track: trackFromFile(
        file,
        path,
        metadata[index],
        source === "files" ? directoryName : "",
      ),
      embeddedCover: embeddedArtwork[index],
    }))
    .sort((left, right) => compareMetadataTracks(left.track, right.track));
  const tracks = trackEntries.map(({ track }) => track);

  tracks.forEach((track, index) => {
    const artist = track.artist || "Unknown artist";
    const albumArtist = track.albumArtist || artist;
    const album = track.album || "Unknown album";
    const artistId = localArtistId(artist);
    const albumArtistId = localArtistId(albumArtist);
    const albumId = localAlbumId(albumArtist, album);
    const directory = pathDirectory(track.localPath || "");
    const albumCover = preferredArtwork(artwork, directory);
    const songCover = sameStemArtwork.get(
      `${directory}\u001f${normalizedStem(track.localPath || "")}`,
    );
    const embeddedCover = trackEntries[index].embeddedCover;
    const trackCover = embeddedCover || songCover || albumCover;
    track.artist = artist;
    track.artistId = artistId;
    track.albumArtist = albumArtist;
    track.album = album;
    track.albumId = albumId;
    track.localArtworkUrl = trackCover;
    if (!albumArtwork.has(albumId) && trackCover)
      albumArtwork.set(albumId, trackCover);

    const albumRecord = albumsById.get(albumId) || {
      id: albumId,
      source: "local",
      name: album,
      artist: albumArtist,
      artistId: albumArtistId,
      song: [],
      songCount: 0,
      duration: 0,
      localModified: 0,
    };
    albumRecord.song!.push(track);
    albumRecord.songCount = albumRecord.song!.length;
    albumRecord.localModified = Math.max(
      albumRecord.localModified || 0,
      track.localModified || 0,
    );
    albumRecord.localArtworkUrl =
      albumArtwork.get(albumId) || albumRecord.localArtworkUrl;
    albumsById.set(albumId, albumRecord);

    const artistRecord = artistsById.get(albumArtistId) || {
      id: albumArtistId,
      source: "local",
      name: albumArtist,
      album: [],
      albumCount: 0,
    };
    if (!artistRecord.album!.some((item) => item.id === albumId)) {
      artistRecord.album!.push(albumRecord);
      artistRecord.albumCount = artistRecord.album!.length;
    }
    const artistCover = preferredArtwork(
      artwork,
      artistDirectory(
        track.localPath || "",
        source === "files" ? directoryName : "",
      ),
      albumRecord.localArtworkUrl,
    );
    if (artistCover && !artistArtwork.has(albumArtistId)) {
      artistArtwork.set(albumArtistId, artistCover);
      artistRecord.localArtworkUrl = artistCover;
    }
    artistRecord.localModified = Math.max(
      artistRecord.localModified || 0,
      track.localModified || 0,
    );
    artistsById.set(albumArtistId, artistRecord);
  });

  const albums = [...albumsById.values()].sort((left, right) =>
    (left.name || "").localeCompare(right.name || "", undefined, {
      sensitivity: "base",
    }),
  );
  const artists = [...artistsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
  const recentAlbums = [...albums].sort(
    (left, right) =>
      (right.localModified || 0) - (left.localModified || 0) ||
      (left.name || "").localeCompare(right.name || "", undefined, {
        sensitivity: "base",
      }),
  );
  return {
    directoryName,
    source,
    tracks,
    albums,
    recentAlbums,
    artists,
    artworkUrls,
  };
};

export async function localLibraryFromFileList(
  files: FileList | File[],
): Promise<LocalMusicLibrary> {
  const entries = Array.from(files).map((file) => ({ file, path: filePath(file) }));
  const firstPath = entries[0]?.path || "";
  const directoryName = firstPath.split(/[\\/]/).filter(Boolean)[0] || "Selected folder";
  return libraryFromFiles(entries, directoryName, "files");
}

export async function scanLocalDirectory(
  directory: LocalDirectoryHandle,
): Promise<LocalMusicLibrary> {
  const files: Array<{ file: File; path: string }> = [];
  const visit = async (
    current: LocalDirectoryHandle,
    prefix: string,
  ): Promise<void> => {
    for await (const entry of current.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        await visit(entry, path);
      } else if (
        entry.kind === "file" &&
        (isSupportedAudioFile(path) || isSupportedImageFile(path))
      ) {
        files.push({ file: await entry.getFile(), path });
      }
    }
  };
  await visit(directory, "");
  return libraryFromFiles(files, directory.name, "directory");
}

const openDatabase = (): Promise<IDBDatabase | null> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(LOCAL_MUSIC_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOCAL_MUSIC_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function saveLocalDirectoryHandle(
  handle: LocalDirectoryHandle,
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_MUSIC_STORE, "readwrite");
    transaction.objectStore(LOCAL_MUSIC_STORE).put(handle, LOCAL_MUSIC_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

export async function clearLocalDirectoryHandle(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_MUSIC_STORE, "readwrite");
    transaction.objectStore(LOCAL_MUSIC_STORE).delete(LOCAL_MUSIC_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

async function storedLocalDirectoryHandle(): Promise<LocalDirectoryHandle | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise<LocalDirectoryHandle | null>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_MUSIC_STORE, "readonly");
    const request = transaction
      .objectStore(LOCAL_MUSIC_STORE)
      .get(LOCAL_MUSIC_HANDLE_KEY);
    request.onsuccess = () =>
      resolve((request.result as LocalDirectoryHandle | undefined) || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function restoreLocalMusicDirectory(): Promise<LocalMusicLibrary | null> {
  const handle = await storedLocalDirectoryHandle();
  if (!handle) return null;
  try {
    const permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted") return null;
    return await scanLocalDirectory(handle);
  } catch {
    return null;
  }
}

export async function chooseLocalDirectory(): Promise<LocalMusicLibrary | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ mode: "read" });
  const library = await scanLocalDirectory(handle);
  try {
    await saveLocalDirectoryHandle(handle);
  } catch {
    // The folder is still usable for this session if IndexedDB is unavailable.
  }
  return library;
}

export function releaseLocalMusicLibrary(library: LocalMusicLibrary | null) {
  if (!library) return;
  const urls = new Set([
    ...library.artworkUrls,
    ...library.tracks.map((track) => track.localUrl).filter(Boolean),
  ]);
  urls.forEach((url) => {
    if (!url?.startsWith("blob:")) return;
    discardArtworkStill(url);
    URL.revokeObjectURL(url);
  });
}
