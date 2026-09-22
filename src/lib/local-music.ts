import {
  type AlbumRecord,
  type Artist,
  type Song,
} from "./navidrome";
import { discardArtworkStillCanvas } from "./artwork";
import {
  registerLocalFiles,
  releaseLocalFiles,
  type LocalFileSet,
} from "./local-file-registry";
import { startLocalLibraryScan } from "./local-library-perf";

const LOCAL_MUSIC_DB = "volta-local-music";
const LOCAL_MUSIC_STORE = "settings";
const LOCAL_METADATA_STORE = "track-metadata";
const LOCAL_ARTWORK_STORE = "folder-artwork";
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
  /** Embedded folder artwork read during this scan, ready to be cached. */
  freshFolderArtwork?: Array<{ path: string; artwork: Blob; source: string }>;
  /**
   * Files registered for on-demand playback URLs. Held so that releasing this
   * library cannot revoke URLs belonging to a newer one.
   */
  fileSet?: LocalFileSet;
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
/** A file discovered by the walk, before its `File` object is materialized. */
type PendingFileEntry = { handle: LocalFileHandle; path: string; file?: File };
/** Metadata remembered across sessions, keyed by library path. */
export type CachedMetadata = {
  size: number;
  lastModified: number;
  metadata: ParsedMetadata;
};

/** Embedded cover art remembered across sessions, keyed by folder path. */
export type CachedFolderArtwork = {
  artwork: Blob;
  /** Fingerprint of the file the artwork was read from, for invalidation. */
  source: string;
};

/**
 * Run `task` over `items` with a bounded number of concurrent workers.
 * Never an unbounded `Promise.all`, which would open thousands of file
 * handles at once on a large library.
 */
const runPool = async <T>(
  items: readonly T[],
  workers: number,
  task: (item: T) => Promise<void>,
) => {
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) await task(items[nextIndex++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, run),
  );
};
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
/**
 * Metadata always sits at the front of a FLAC or ID3 file, but cover art can
 * push the tag region hundreds of kilobytes in, and MP4 parks its `moov` box
 * at the end for streamed files. So read a small head first, then extend the
 * read only as far as the tags actually reach. Reading a flat window from
 * every track used to pull hundreds of megabytes of audio off disk before a
 * large library could open.
 */
const METADATA_HEAD_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const METADATA_READERS = 64;
/** Bounded pool for `FileSystemFileHandle.getFile()` during a directory scan. */
const FILE_MATERIALIZERS = 16;
/** Tail windows tried, smallest first, when an MP4 `moov` box is not in the head. */
const MP4_TAIL_WINDOWS = [64 * 1024, 256 * 1024, 1024 * 1024];

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
  String.fromCharCode(...bytes.subarray(start, start + length));

const bigEndian32 = (bytes: Uint8Array, offset: number) =>
  (((bytes[offset] || 0) << 24) |
    ((bytes[offset + 1] || 0) << 16) |
    ((bytes[offset + 2] || 0) << 8) |
    (bytes[offset + 3] || 0)) >>> 0;

const bigEndian16 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);

const bigEndian24 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] || 0) << 16) |
  ((bytes[offset + 1] || 0) << 8) |
  (bytes[offset + 2] || 0);

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

const ID3_TEXT_FIELDS: Record<string, string> = {
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

/**
 * Apply one already-read ID3 frame. APIC needs care: the cover image is the
 * frame payload, so callers only read that frame when artwork is wanted.
 */
const applyId3Frame = (
  metadata: ParsedMetadata,
  id: string,
  frame: Uint8Array,
  includeArtwork: boolean,
) => {
  const field = ID3_TEXT_FIELDS[id];
  if (field && frame.length > 1)
    metadataField(metadata, field, decodeBytes(frame.subarray(1), frame[0]));
  if (id !== "APIC" || !includeArtwork || frame.length <= 4) return;
  const encoding = frame[0];
  let cursor = 1;
  while (cursor < frame.length && frame[cursor] !== 0) cursor++;
  const mime =
    new TextDecoder().decode(frame.subarray(1, cursor)) || "image/jpeg";
  cursor += 2;
  if (cursor >= frame.length) return;
  cursor++;
  const wide = encoding === 1 || encoding === 2;
  while (
    cursor < frame.length &&
    (wide
      ? frame[cursor] !== 0 || frame[cursor + 1] !== 0
      : frame[cursor] !== 0)
  )
    cursor += wide ? 2 : 1;
  cursor += wide ? 2 : 1;
  if (cursor < frame.length)
    metadata.artwork = new Blob([new Uint8Array(frame.subarray(cursor))], {
      type: mime,
    });
};

/**
 * Walk an ID3v2 tag frame by frame, reading only the frames that carry
 * information we keep. A tag-only scan never touches the APIC payload, which
 * for tagged libraries is by far the largest part of the tag region.
 */
const readId3Metadata = async (
  file: File,
  head: Uint8Array,
  includeArtwork: boolean,
): Promise<ParsedMetadata> => {
  const metadata: ParsedMetadata = {};
  const version = head[3] || 3;
  const tagEnd = Math.min(id3TagEnd(head, file.size), MAX_METADATA_BYTES);
  let offset = 10;
  if (head[5] & 0x40) {
    const extendedSize =
      version >= 4 ? syncSafe32(head, offset) : bigEndian32(head, offset);
    offset += 4 + extendedSize;
  }
  const readAt = async (start: number, length: number) =>
    start + length <= head.length
      ? head.subarray(start, start + length)
      : await readFileRange(file, start, Math.min(start + length, file.size));
  while (offset + 10 <= tagEnd) {
    const header = await readAt(offset, 10);
    if (header.length < 10) break;
    const id = ascii(header, 0, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size =
      version >= 4 ? syncSafe32(header, 4) : bigEndian32(header, 4);
    if (!size || offset + 10 + size > tagEnd) break;
    if (ID3_TEXT_FIELDS[id] || (includeArtwork && id === "APIC"))
      applyId3Frame(
        metadata,
        id,
        await readAt(offset + 10, size),
        includeArtwork,
      );
    offset += 10 + size;
  }
  return metadata;
};

/** Apply a FLAC VORBIS_COMMENT block, which holds the text tags. */
const parseVorbisComment = (metadata: ParsedMetadata, block: Uint8Array) => {
  let cursor = 4 + littleEndian32(block, 0);
  const count = littleEndian32(block, cursor);
  cursor += 4;
  for (let index = 0; index < count && cursor + 4 <= block.length; index++) {
    const size = littleEndian32(block, cursor);
    cursor += 4;
    if (cursor + size > block.length) break;
    const value = new TextDecoder().decode(block.subarray(cursor, cursor + size));
    cursor += size;
    const separator = value.indexOf("=");
    if (separator > 0)
      metadataField(
        metadata,
        value.slice(0, separator).toLowerCase(),
        value.slice(separator + 1),
      );
  }
};

/** Apply a FLAC PICTURE block. The payload after the header is the image. */
const parseFlacPicture = (metadata: ParsedMetadata, block: Uint8Array) => {
  let cursor = 4;
  const mimeLength = bigEndian32(block, cursor);
  cursor += 4 + mimeLength;
  const descriptionLength = bigEndian32(block, cursor);
  cursor += 4 + descriptionLength + 16;
  if (cursor + 4 > block.length) return;
  const imageLength = bigEndian32(block, cursor);
  const imageStart = cursor + 4;
  if (imageStart + imageLength > block.length) return;
  const mime = new TextDecoder().decode(block.subarray(8, 8 + mimeLength));
  metadata.artwork = new Blob(
    [new Uint8Array(block.subarray(imageStart, imageStart + imageLength))],
    { type: mime || "image/jpeg" },
  );
};

const parseMp4 = (bytes: Uint8Array, includeArtwork = true): ParsedMetadata => {
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
            const value = bytes.subarray(child + 16, childEnd);
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
            else if (type === "covr" && includeArtwork)
              metadata.artwork = new Blob([new Uint8Array(value)], {
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
  // Byte comparison rather than building a string per position: this walks
  // every offset of a multi-megabyte tail buffer.
  const a = wanted.charCodeAt(0);
  const b = wanted.charCodeAt(1);
  const c = wanted.charCodeAt(2);
  const d = wanted.charCodeAt(3);
  for (let offset = 4; offset + 8 <= bytes.length; offset++) {
    if (
      bytes[offset] !== a ||
      bytes[offset + 1] !== b ||
      bytes[offset + 2] !== c ||
      bytes[offset + 3] !== d
    )
      continue;
    const start = offset - 4;
    const size = bigEndian32(bytes, start);
    if (size >= 8 && start + size <= bytes.length)
      return bytes.subarray(start, start + size);
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

const readFileRange = async (file: File, start: number, end: number) =>
  new Uint8Array(await file.slice(start, end).arrayBuffer());

/** End of an ID3v2 tag, which declares its own size in the ten-byte header. */
const id3TagEnd = (head: Uint8Array, fileSize: number) =>
  Math.min(fileSize, 10 + syncSafe32(head, 6));

/**
 * Read FLAC tags — and the cover image, when wanted — without ever pulling the
 * PICTURE payload for a tag-only scan. Only four-byte block headers are read
 * while walking, then just the VORBIS_COMMENT block for tags and, separately,
 * the PICTURE payload when artwork is requested.
 */
const readFlacMetadata = async (
  file: File,
  head: Uint8Array,
  includeArtwork: boolean,
): Promise<ParsedMetadata> => {
  const metadata: ParsedMetadata = {};
  const readAt = async (start: number, length: number) =>
    start + length <= head.length
      ? head.subarray(start, start + length)
      : await readFileRange(file, start, Math.min(start + length, file.size));
  let offset = 4;
  for (let guard = 0; guard < 64; guard++) {
    const header = await readAt(offset, 4);
    if (header.length < 4) break;
    const last = (header[0] & 0x80) !== 0;
    const type = header[0] & 0x7f;
    const length = bigEndian24(header, 1);
    const start = offset + 4;
    if (start + length > file.size) break;
    if (type === 4) parseVorbisComment(metadata, await readAt(start, length));
    else if (type === 6 && includeArtwork)
      parseFlacPicture(metadata, await readAt(start, length));
    offset = start + length;
    if (last) break;
  }
  return metadata;
};

/** Top-level MP4 boxes whose header lies inside `bytes`. */
const mp4TopLevelBoxes = (bytes: Uint8Array) => {
  const boxes: Array<{ type: string; start: number; size: number }> = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = bigEndian32(bytes, offset);
    if (size < 8) break;
    boxes.push({ type: ascii(bytes, offset + 4, 4), start: offset, size });
    offset += size;
  }
  return boxes;
};

const readMp4Metadata = async (
  file: File,
  head: Uint8Array,
  includeArtwork: boolean,
) => {
  const moov = mp4TopLevelBoxes(head).find((box) => box.type === "moov");
  if (moov) {
    const end = Math.min(moov.start + moov.size, MAX_METADATA_BYTES);
    return parseMp4(
      end <= head.length ? head : await readFileRange(file, 0, end),
      includeArtwork,
    );
  }
  // Streamed files park `moov` at the end. Grow the tail window instead of
  // always pulling a megabyte, because most files need far less than that.
  for (const window of MP4_TAIL_WINDOWS) {
    const tail = await readFileRange(
      file,
      Math.max(0, file.size - window),
      file.size,
    );
    const found = findMp4Box(tail, "moov");
    if (found)
      return mergeMetadata(
        parseMp4(head, includeArtwork),
        parseMp4(found, includeArtwork),
      );
    if (tail.length < window) break;
  }
  return parseMp4(head, includeArtwork);
};

const readAudioMetadata = async (
  file: File,
  includeArtwork = true,
): Promise<ParsedMetadata> => {
  try {
    const head = await readFileRange(
      file,
      0,
      Math.min(file.size, METADATA_HEAD_BYTES),
    );
    if (ascii(head, 0, 3) === "ID3")
      return await readId3Metadata(file, head, includeArtwork);
    if (ascii(head, 0, 4) === "fLaC")
      return await readFlacMetadata(file, head, includeArtwork);
    if (ascii(head, 4, 4) === "ftyp")
      return await readMp4Metadata(file, head, includeArtwork);
  } catch {
    /* Metadata is optional; the filename remains a display-only fallback. */
  }
  return {};
};

const readAudioMetadataBatch = async (
  files: LocalFileEntry[],
  /** Already-known metadata for unchanged files, keyed by library path. */
  cached?: ReadonlyMap<string, CachedMetadata>,
) => {
  const metadata: ParsedMetadata[] = Array.from(
    { length: files.length },
    () => ({}),
  );
  let nextIndex = 0;
  const readNext = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++;
      const entry = files[index];
      const hit = cached?.get(entry.path);
      if (
        hit &&
        hit.size === entry.file.size &&
        hit.lastModified === entry.file.lastModified
      ) {
        metadata[index] = hit.metadata;
        continue;
      }
      metadata[index] = await readAudioMetadata(entry.file, false);
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

/**
 * Embedded cover art is stored once per album, so a library with a hundred
 * albums and two thousand tracks only needs a hundred covers read. Pick the
 * first track of each folder as that folder's representative — but skip
 * folders that already ship a cover image as a file, since there is nothing to
 * gain from reading the embedded copy.
 */
const artworkRepresentatives = (
  audioFiles: LocalFileEntry[],
  foldersWithExternalArtwork: ReadonlySet<string>,
) => {
  const indexes = new Set<number>();
  const seenDirectories = new Set<string>();
  audioFiles.forEach((entry, index) => {
    const directory = pathDirectory(entry.path);
    if (seenDirectories.has(directory)) return;
    seenDirectories.add(directory);
    if (foldersWithExternalArtwork.has(directory)) return;
    indexes.add(index);
  });
  return indexes;
};

/**
 * Read embedded cover art, one folder at a time, reusing cached artwork for
 * folders whose representative track has not changed. Returns object URLs
 * keyed by folder path.
 */
const readFolderArtwork = async (
  audioFiles: LocalFileEntry[],
  representativeIndexes: ReadonlySet<number>,
  cached?: ReadonlyMap<string, CachedFolderArtwork>,
) => {
  const urls = new Map<string, string>();
  const entries = [...representativeIndexes]
    .map((index) => audioFiles[index])
    .filter((entry): entry is LocalFileEntry => Boolean(entry));
  const fresh: Array<{ path: string; artwork: Blob; source: string }> = [];
  await runPool(entries, METADATA_READERS, async (entry) => {
    const directory = pathDirectory(entry.path);
    const source = `${entry.file.size}:${entry.file.lastModified}`;
    const hit = cached?.get(directory);
    if (hit && hit.source === source) {
      urls.set(directory, URL.createObjectURL(hit.artwork));
      return;
    }
    const metadata = await readAudioMetadata(entry.file, true);
    if (!metadata.artwork) return;
    urls.set(directory, URL.createObjectURL(metadata.artwork));
    fresh.push({ path: directory, artwork: metadata.artwork, source });
  });
  return { urls, fresh };
};

const filePath = (file: File) =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
  file.name;

/**
 * The persisted shape of a track's tags. Object URLs and `File` handles are
 * deliberately excluded: they are session-only and cannot be stored.
 */
const metadataFromSong = (song: Song): ParsedMetadata => ({
  title: song.title,
  artist: song.artist,
  albumArtist: song.albumArtist,
  composer: song.composer,
  album: song.album,
  track: song.track,
  discNumber: song.discNumber,
  year: song.year,
  genre: song.genre,
  codec: song.codec,
  bitDepth: song.bitDepth,
  samplingRate: song.samplingRate,
});

/** Persist metadata and fresh folder artwork for a built library. */
export const cacheLibraryMetadata = async (
  library: LocalMusicLibrary,
  cached: ReadonlyMap<string, CachedMetadata>,
) => {
  await Promise.all([
    writeCachedMetadata(
      library.tracks.map((track) => ({
        path: track.localPath || track.id,
        size: track.size || 0,
        lastModified: track.localModified || 0,
        metadata: metadataFromSong(track),
      })),
      cached,
    ),
    writeCachedFolderArtwork(library.freshFolderArtwork || []),
  ]);
};

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

/**
 * Resolve the best folder image per directory in one pass. Each item is
 * compared only against the current best for its own directory, preserving the
 * original preference order and path tie-break without re-filtering or
 * re-sorting the whole artwork list per directory.
 */
const preferredArtworkByDirectory = (artwork: LocalArtwork[]) => {
  const best = new Map<string, LocalArtwork>();
  const beats = (candidate: LocalArtwork, current: LocalArtwork) => {
    const score =
      (PREFERRED_ARTWORK_NAMES.get(candidate.stem) || 0) -
      (PREFERRED_ARTWORK_NAMES.get(current.stem) || 0);
    if (score !== 0) return score > 0;
    // Equal preference: the later path in base-collated order wins, matching
    // the previous `sort(...).at(-1)` result.
    return (
      candidate.path.localeCompare(current.path, undefined, {
        sensitivity: "base",
      }) > 0
    );
  };
  for (const item of artwork) {
    const current = best.get(item.directory);
    if (!current || beats(item, current)) best.set(item.directory, item);
  }
  const resolved = new Map<string, string>();
  for (const [directory, item] of best) resolved.set(directory, item.url);
  return resolved;
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
  cached?: ReadonlyMap<string, CachedMetadata>,
  cachedArtwork?: ReadonlyMap<string, CachedFolderArtwork>,
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
  const scan = startLocalLibraryScan();
  scan.mark("artwork index");
  const folderArtwork = preferredArtworkByDirectory(artwork);
  // Tags come from every track; embedded covers come from one representative
  // track per folder. Both halves are cached independently, so an unchanged
  // library does no metadata parsing at all on the next scan.
  const representatives = artworkRepresentatives(
    audioFiles,
    new Set(folderArtwork.keys()),
  );
  const metadata = await readAudioMetadataBatch(audioFiles, cached);
  scan.mark("tags");
  const folderArtworkResult = await readFolderArtwork(
    audioFiles,
    representatives,
    cachedArtwork,
  );
  const albumArtworkByDirectory = folderArtworkResult.urls;
  scan.mark("embedded artwork");
  const artworkUrls = [
    ...artwork.map((item) => item.url),
    ...albumArtworkByDirectory.values(),
  ];
  scan.mark("object urls");
  const sameStemArtwork = new Map(
    artwork.map((item) => [`${item.directory}\u001f${item.stem}`, item.url]),
  );
  // Albums are keyed by tag, but cover art is looked up by folder, so remember
  // each album's first folder to avoid re-deriving it during artist grouping.
  const albumFolder = new Map<string, string>();
  const albumArtwork = new Map<string, string>();
  const artistArtwork = new Map<string, string>();
  const albumsById = new Map<string, AlbumRecord>();
  const artistsById = new Map<string, Artist>();
  const artistAlbumIds = new Map<string, Set<string>>();
  const trackEntries = audioFiles
    .map(({ file, path }, index) => ({
      track: trackFromFile(
        file,
        path,
        metadata[index],
        source === "files" ? directoryName : "",
      ),
      // The folder's representative track supplied this cover.
      embeddedCover: albumArtworkByDirectory.get(pathDirectory(path)),
    }))
    .sort((left, right) => compareMetadataTracks(left.track, right.track));
  const tracks = trackEntries.map(({ track }) => track);
  scan.mark("tracks");
  // Playback URLs are minted on demand from these files instead of one object
  // URL per track up front.
  const fileSet = registerLocalFiles(
    audioFiles.map((entry) => ({ path: entry.path, file: entry.file })),
  );

  tracks.forEach((track, index) => {
    const artist = track.artist || "Unknown artist";
    const albumArtist = track.albumArtist || artist;
    const album = track.album || "Unknown album";
    const artistId = localArtistId(artist);
    const albumArtistId = localArtistId(albumArtist);
    const albumId = localAlbumId(albumArtist, album);
    const directory = pathDirectory(track.localPath || "");
    const albumCover = folderArtwork.get(directory) || undefined;
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
    if (!albumFolder.has(albumId)) albumFolder.set(albumId, directory);

    const artistRecord = artistsById.get(albumArtistId) || {
      id: albumArtistId,
      source: "local",
      name: albumArtist,
      album: [],
      albumCount: 0,
    };
    // O(1) membership instead of scanning the artist's albums per track.
    let artistAlbums = artistAlbumIds.get(albumArtistId);
    if (!artistAlbums) {
      artistAlbums = new Set<string>();
      artistAlbumIds.set(albumArtistId, artistAlbums);
    }
    if (!artistAlbums.has(albumId)) {
      artistAlbums.add(albumId);
      artistRecord.album!.push(albumRecord);
      artistRecord.albumCount = artistRecord.album!.length;
    }
    const artistCover =
      folderArtwork.get(
        artistDirectory(
          track.localPath || "",
          source === "files" ? directoryName : "",
        ),
      ) || albumRecord.localArtworkUrl;
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
  scan.mark("aggregation");
  scan.end(`${directoryName}: ${tracks.length} tracks`);
  return {
    directoryName,
    source,
    tracks,
    albums,
    recentAlbums,
    artists,
    artworkUrls,
    freshFolderArtwork: folderArtworkResult.fresh,
    fileSet,
  };
};

export async function localLibraryFromFileList(
  files: FileList | File[],
): Promise<LocalMusicLibrary> {
  const entries = Array.from(files).map((file) => ({ file, path: filePath(file) }));
  const firstPath = entries[0]?.path || "";
  const directoryName = firstPath.split(/[\\/]/).filter(Boolean)[0] || "Selected folder";
  // A file-list import can reuse the same cache: the paths line up with the
  // directory scan because both are relative to the chosen root.
  const cached = await readCachedMetadata();
  const library = await libraryFromFiles(entries, directoryName, "files", cached);
  void cacheLibraryMetadata(library, cached).catch(() => {
    /* Caching is an optimization; the library still works without it. */
  });
  return library;
}

export async function scanLocalDirectory(
  directory: LocalDirectoryHandle,
  cached?: ReadonlyMap<string, CachedMetadata>,
  cachedArtwork?: ReadonlyMap<string, CachedFolderArtwork>,
): Promise<LocalMusicLibrary> {
  const scan = startLocalLibraryScan();
  const files: PendingFileEntry[] = [];
  // Traversal and materialization are separate: the walk only collects
  // handles, then a bounded pool turns them into File objects. Doing
  // `await entry.getFile()` inside the walk serialized thousands of calls.
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
        files.push({ handle: entry, path });
      }
    }
  };
  await visit(directory, "");
  scan.mark("directory walk");
  await runPool(files, FILE_MATERIALIZERS, async (entry) => {
    entry.file = await entry.handle.getFile();
  });
  scan.mark("file materialization");
  return libraryFromFiles(
    files as LocalFileEntry[],
    directory.name,
    "directory",
    cached,
    cachedArtwork,
  );
}

const openDatabase = (): Promise<IDBDatabase | null> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(LOCAL_MUSIC_DB, 2);
    // Version 1 only had the settings store. Existing installs upgrade in place
    // and keep their saved directory handle.
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LOCAL_MUSIC_STORE))
        database.createObjectStore(LOCAL_MUSIC_STORE);
      if (!database.objectStoreNames.contains(LOCAL_METADATA_STORE))
        database.createObjectStore(LOCAL_METADATA_STORE);
      if (!database.objectStoreNames.contains(LOCAL_ARTWORK_STORE))
        database.createObjectStore(LOCAL_ARTWORK_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export type LocalLibraryCacheMetrics = {
  metadataEntries: number;
  artworkEntries: number;
  bytes: number;
};

/** Inspect only rebuildable scan/artwork stores; the saved folder handle stays intact. */
export async function inspectLocalLibraryCaches(): Promise<LocalLibraryCacheMetrics> {
  const metrics: LocalLibraryCacheMetrics = {
    metadataEntries: 0,
    artworkEntries: 0,
    bytes: 0,
  };
  const database = await openDatabase();
  if (!database) return metrics;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [LOCAL_METADATA_STORE, LOCAL_ARTWORK_STORE],
      "readonly",
    );
    const metadataCursor = transaction.objectStore(LOCAL_METADATA_STORE).openCursor();
    metadataCursor.onsuccess = () => {
      const cursor = metadataCursor.result;
      if (!cursor) return;
      metrics.metadataEntries += 1;
      try {
        metrics.bytes += JSON.stringify(cursor.value).length * 2;
      } catch {
        // The browser quota estimate below still includes non-JSON values.
      }
      cursor.continue();
    };
    const artworkCursor = transaction.objectStore(LOCAL_ARTWORK_STORE).openCursor();
    artworkCursor.onsuccess = () => {
      const cursor = artworkCursor.result;
      if (!cursor) return;
      const value = cursor.value as CachedFolderArtwork | undefined;
      metrics.artworkEntries += 1;
      metrics.bytes += value?.artwork?.size ?? 0;
      metrics.bytes += (value?.source?.length ?? 0) * 2;
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
  return metrics;
}

/** Clear rebuildable local library data without forgetting the chosen folder. */
export async function clearLocalLibraryCaches(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [LOCAL_METADATA_STORE, LOCAL_ARTWORK_STORE],
      "readwrite",
    );
    transaction.objectStore(LOCAL_METADATA_STORE).clear();
    transaction.objectStore(LOCAL_ARTWORK_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

/**
 * Every cached entry, keyed by library path. Missing cache is not an error.
 */
export async function readCachedMetadata(): Promise<Map<string, CachedMetadata>> {
  const database = await openDatabase();
  if (!database) return new Map();
  return new Promise<Map<string, CachedMetadata>>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_METADATA_STORE, "readonly");
    const store = transaction.objectStore(LOCAL_METADATA_STORE);
    const entries = new Map<string, CachedMetadata>();
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const result = cursor.result;
      if (!result) return;
      const value = result.value as CachedMetadata | undefined;
      if (value && typeof value.size === "number")
        entries.set(String(result.key), value);
      result.continue();
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(entries);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

/** Embedded cover art per folder, keyed by folder path. */
export async function readCachedFolderArtwork(): Promise<
  Map<string, CachedFolderArtwork>
> {
  const database = await openDatabase();
  if (!database) return new Map();
  return new Promise<Map<string, CachedFolderArtwork>>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_ARTWORK_STORE, "readonly");
    const store = transaction.objectStore(LOCAL_ARTWORK_STORE);
    const entries = new Map<string, CachedFolderArtwork>();
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const result = cursor.result;
      if (!result) return;
      const value = result.value as CachedFolderArtwork | undefined;
      if (value && value.artwork) entries.set(String(result.key), value);
      result.continue();
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(entries);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

/**
 * Persist tag metadata and drop rows for paths that no longer exist. Only rows
 * that actually changed are rewritten.
 */
export async function writeCachedMetadata(
  entries: Array<{ path: string; size: number; lastModified: number; metadata: ParsedMetadata }>,
  cached: ReadonlyMap<string, CachedMetadata>,
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  const present = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_METADATA_STORE, "readwrite");
    const store = transaction.objectStore(LOCAL_METADATA_STORE);
    for (const entry of entries) {
      present.add(entry.path);
      const previous = cached.get(entry.path);
      if (
        previous &&
        previous.size === entry.size &&
        previous.lastModified === entry.lastModified
      )
        continue;
      store.put(
        { size: entry.size, lastModified: entry.lastModified, metadata: entry.metadata },
        entry.path,
      );
    }
    // Stale rows: files that were deleted or renamed away.
    for (const path of cached.keys())
      if (!present.has(path)) store.delete(path);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

/** Persist embedded folder artwork, replacing rows for changed folders. */
export async function writeCachedFolderArtwork(
  entries: Array<{ path: string; artwork: Blob; source: string }>,
): Promise<void> {
  if (!entries.length) return;
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_ARTWORK_STORE, "readwrite");
    const store = transaction.objectStore(LOCAL_ARTWORK_STORE);
    for (const entry of entries)
      store.put({ artwork: entry.artwork, source: entry.source }, entry.path);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

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
    const [cached, cachedArtwork] = await Promise.all([
      readCachedMetadata(),
      readCachedFolderArtwork(),
    ]);
    const library = await scanLocalDirectory(handle, cached, cachedArtwork);
    void cacheLibraryMetadata(library, cached).catch(() => {
      /* Caching is an optimization; the library still works without it. */
    });
    return library;
  } catch {
    return null;
  }
}

export async function chooseLocalDirectory(): Promise<LocalMusicLibrary | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ mode: "read" });
  const [cached, cachedArtwork] = await Promise.all([
    readCachedMetadata(),
    readCachedFolderArtwork(),
  ]);
  const library = await scanLocalDirectory(handle, cached, cachedArtwork);
  void cacheLibraryMetadata(library, cached).catch(() => {
    /* Caching is an optimization; the library still works without it. */
  });
  try {
    await saveLocalDirectoryHandle(handle);
  } catch {
    // The folder is still usable for this session if IndexedDB is unavailable.
  }
  return library;
}

export function releaseLocalMusicLibrary(library: LocalMusicLibrary | null) {
  // The registry owns every local playback URL, including ones created after
  // the scan, so releasing it covers all of them. A library that was already
  // replaced is ignored, which keeps the current library's URLs alive.
  releaseLocalFiles(library?.fileSet);
  if (!library) return;
  library.artworkUrls.forEach((url) => {
    if (!url?.startsWith("blob:")) return;
    discardArtworkStillCanvas(url);
    URL.revokeObjectURL(url);
  });
}
