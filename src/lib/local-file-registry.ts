/**
 * Playback URLs for local files, created on demand.
 *
 * A library scan produces a `File` for every track, but only a handful are ever
 * played. Creating an object URL for each one cost ~150ms on a 1,700-track
 * library and left ~1,700 live blob URLs to track. Instead the scan registers
 * the files and a URL is minted the first time a track is actually streamed.
 *
 * This module deliberately has no imports so both `local-music.ts` and
 * `navidrome.ts` can use it without creating a cycle.
 */

export type LocalFileSet = {
  files: Map<string, File>;
  urls: Map<string, string>;
};

let activeSet: LocalFileSet | null = null;

/** Register the files of a freshly scanned library, replacing the previous set. */
export const registerLocalFiles = (
  entries: Array<{ path: string; file: File }>,
): LocalFileSet => {
  clearLocalFiles();
  const set: LocalFileSet = { files: new Map(), urls: new Map() };
  for (const entry of entries) set.files.set(entry.path, entry.file);
  activeSet = set;
  return set;
};

/**
 * Object URL for a local track, created on first use and reused afterwards.
 * Returns undefined when the path is not part of the active library.
 */
export const localFileUrl = (path?: string): string | undefined => {
  const set = activeSet;
  if (!path || !set) return undefined;
  const existing = set.urls.get(path);
  if (existing) return existing;
  const file = set.files.get(path);
  if (!file) return undefined;
  const url = URL.createObjectURL(file);
  set.urls.set(path, url);
  return url;
};

/** Revoke everything and forget the active set. */
const clearLocalFiles = () => {
  if (!activeSet) return;
  for (const url of activeSet.urls.values()) URL.revokeObjectURL(url);
  activeSet = null;
};

/**
 * Revoke the URLs belonging to `set`. A set that is not the active one — or a
 * missing set — is left alone, so a late release of a replaced library cannot
 * tear down the files registered by a newer scan.
 */
export const releaseLocalFiles = (set?: LocalFileSet) => {
  if (!set || set !== activeSet) return;
  clearLocalFiles();
};
