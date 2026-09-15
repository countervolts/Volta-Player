import type { Song } from "./navidrome";

/**
 * A folder in the library's on-disk hierarchy.
 *
 * Navidrome does not implement real browse-by-folder: `getIndexes` and
 * `getMusicDirectory` return a simulated tree built from each track's `path`
 * (`/Artist/Album/01 - Song.mp3`). Local libraries carry the same shape in
 * `localPath`. Either way the folder view is derived from the songs the player
 * already holds, so it behaves identically for both sources and needs no extra
 * server round trips.
 */
export type FolderNode = {
  /** Library-relative path, e.g. `Artist/Album`. The root is `""`. */
  path: string;
  /** Last path segment, used as the row label. */
  name: string;
  folders: FolderNode[];
  /** Songs stored directly in this folder. */
  songs: Song[];
  /** Songs in this folder and every descendant. */
  totalSongs: number;
  /** Total size in bytes of songs in this folder and every descendant. */
  totalBytes: number;
  /** Newest modification time among descendant songs, when the source has one. */
  modified?: number;
};

export type FolderTree = {
  root: FolderNode;
  byPath: Map<string, FolderNode>;
  /** False when no song exposed a usable path, so the view can explain why. */
  hasPaths: boolean;
};

const PATH_SEPARATOR = /[\\/]+/;

/** The folder a song lives in, relative to the library root. */
export const songFolderPath = (song: Song): string => {
  const raw = (song.localPath || song.path || "").trim();
  if (!raw) return "";
  const segments = raw.split(PATH_SEPARATOR).filter(Boolean);
  // The final segment is the file itself, not a folder.
  segments.pop();
  // A Windows drive letter (`D:`) is a volume, not a folder in the library.
  if (segments.length && /^[a-z]:$/i.test(segments[0])) segments.shift();
  return segments.join("/");
};

const compareSongs = (left: Song, right: Song) =>
  (left.discNumber ?? 1) - (right.discNumber ?? 1) ||
  (left.track ?? Number.MAX_SAFE_INTEGER) -
    (right.track ?? Number.MAX_SAFE_INTEGER) ||
  left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
  (left.localPath || "").localeCompare(right.localPath || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });

const compareFolderNames = (left: FolderNode, right: FolderNode) =>
  left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

export function buildFolderTree(songs: readonly Song[]): FolderTree {
  const root: FolderNode = {
    path: "",
    name: "",
    folders: [],
    songs: [],
    totalSongs: 0,
    totalBytes: 0,
  };
  const byPath = new Map<string, FolderNode>([["", root]]);
  let hasPaths = false;

  const ensure = (path: string): FolderNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const parent = ensure(segments.slice(0, -1).join("/"));
    const node: FolderNode = {
      path,
      name: segments.at(-1) || path,
      folders: [],
      songs: [],
      totalSongs: 0,
      totalBytes: 0,
    };
    parent.folders.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const song of songs) {
    const path = songFolderPath(song);
    if (path) hasPaths = true;
    ensure(path).songs.push(song);
  }

  const finalize = (node: FolderNode): void => {
    node.folders.sort(compareFolderNames);
    node.songs.sort(compareSongs);
    let totalSongs = node.songs.length;
    let totalBytes = 0;
    let modified: number | undefined;
    for (const song of node.songs) {
      totalBytes += song.size || 0;
      if (song.localModified && (!modified || song.localModified > modified))
        modified = song.localModified;
    }
    for (const folder of node.folders) {
      finalize(folder);
      totalSongs += folder.totalSongs;
      totalBytes += folder.totalBytes;
      if (folder.modified && (!modified || folder.modified > modified))
        modified = folder.modified;
    }
    node.totalSongs = totalSongs;
    node.totalBytes = totalBytes;
    node.modified = modified;
  };
  finalize(root);

  return { root, byPath, hasPaths };
}

/** Root first, then each folder down to `path`. */
export function folderAncestors(tree: FolderTree, path: string): FolderNode[] {
  const chain: FolderNode[] = [];
  let current = tree.byPath.get(path) || tree.root;
  while (current) {
    chain.unshift(current);
    if (!current.path) break;
    const parentPath = current.path.split("/").slice(0, -1).join("/");
    current = tree.byPath.get(parentPath) || tree.root;
  }
  return chain;
}

/** Every song in a folder and its descendants, in tree order. */
export function collectFolderSongs(node: FolderNode): Song[] {
  const songs = [...node.songs];
  for (const folder of node.folders) songs.push(...collectFolderSongs(folder));
  return songs;
}

export type FolderSearchResults = {
  folders: FolderNode[];
  songs: { song: Song; folder: FolderNode }[];
};

/** Case-insensitive search across folder names, song tags, and song paths. */
export function searchFolderTree(
  tree: FolderTree,
  query: string,
  limit = 200,
): FolderSearchResults {
  const needle = query.trim().toLowerCase();
  const folders: FolderNode[] = [];
  const songs: { song: Song; folder: FolderNode }[] = [];
  if (!needle) return { folders, songs };
  const visit = (node: FolderNode) => {
    if (node.path && node.name.toLowerCase().includes(needle))
      folders.push(node);
    for (const song of node.songs) {
      if (
        [song.title, song.artist, song.album, songFolderPath(song)]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
        songs.push({ song, folder: node });
    }
    for (const folder of node.folders) visit(folder);
  };
  visit(tree.root);
  return { folders: folders.slice(0, limit), songs: songs.slice(0, limit) };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
