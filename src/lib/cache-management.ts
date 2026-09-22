import { clearArtworkLoadingCache } from "../components";
import {
  clearArtworkDetectionCache,
  clearArtworkStillCache,
} from "./artwork";
import { resetAutomixAnalysis } from "./automix-analyzer";
import { clearLyricsLookupCache } from "./navidrome";
import {
  clearLocalLibraryCaches,
  inspectLocalLibraryCaches,
  type LocalLibraryCacheMetrics,
} from "./local-music";

const LIBRARY_SESSION_CACHE_PREFIX = "volta-library-cache:";
const APP_SHELL_CACHE_PREFIX = "volta-shell-";

export type StorageMetrics = {
  usedBytes?: number;
  quotaBytes?: number;
  localStorageBytes: number;
  sessionStorageBytes: number;
  appShellEntries: number;
  localLibrary: LocalLibraryCacheMetrics;
};

function storageBytes(storage: Storage): number {
  let bytes = 0;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      bytes += (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
    }
  } catch {
    // Storage can be disabled in private browsing or under a strict policy.
  }
  return bytes;
}

async function appShellEntryCount(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  let count = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith(APP_SHELL_CACHE_PREFIX)) continue;
    count += (await (await caches.open(name)).keys()).length;
  }
  return count;
}

/** Browser quota estimate plus the Volta-owned stores that can be rebuilt. */
export async function readStorageMetrics(): Promise<StorageMetrics> {
  const [estimate, appShellEntries, localLibrary] = await Promise.all([
    navigator.storage?.estimate().catch(() => undefined),
    appShellEntryCount().catch(() => 0),
    inspectLocalLibraryCaches().catch(() => ({
      metadataEntries: 0,
      artworkEntries: 0,
      bytes: 0,
    })),
  ]);
  return {
    usedBytes: estimate?.usage,
    quotaBytes: estimate?.quota,
    localStorageBytes: storageBytes(localStorage),
    sessionStorageBytes: storageBytes(sessionStorage),
    appShellEntries,
    localLibrary,
  };
}

/** Clear rebuildable Volta caches while keeping preferences and library access. */
export async function clearVoltaCaches(): Promise<void> {
  clearArtworkLoadingCache();
  clearArtworkStillCache();
  clearArtworkDetectionCache();
  clearLyricsLookupCache();
  resetAutomixAnalysis();

  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(LIBRARY_SESSION_CACHE_PREFIX))
      sessionStorage.removeItem(key);
  }

  const work: Promise<unknown>[] = [clearLocalLibraryCaches()];
  if (typeof caches !== "undefined") {
    work.push(
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(APP_SHELL_CACHE_PREFIX))
            .map((name) => caches.delete(name)),
        ),
      ),
    );
  }
  const results = await Promise.allSettled(work);
  if (results.some((result) => result.status === "rejected"))
    throw new Error("Some Volta caches could not be cleared.");
}

export function formatStorageBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "Not reported";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
