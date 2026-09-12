import {
  createPortal,
} from "react-dom";
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Disc3,
  Ellipsis,
  ListEnd,
  ListMusic,
  ListPlus,
  LoaderCircle,
  Music2,
  Play,
  Star,
  X,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  albumName,
  duration,
  isLossless,
  type AlbumRecord,
  type Navidrome,
  type Song,
} from "./lib/navidrome";
import { discardArtworkStill, loadArtworkStill } from "./lib/artwork";

const ArtworkMotionContext = createContext({
  enabled: true,
  everywhere: false,
  experimentalLoading: false,
});

export type ContextMenuItem =
  | {
      label: string;
      icon: ReactNode;
      onSelect: () => void;
    }
  | { separator: true };

export function ContextMenu({
  point,
  items,
  label,
  onClose,
}: {
  point: { x: number; y: number } | null;
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!point) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", onClose);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, point]);

  if (!point) return null;
  const left = Math.max(8, Math.min(point.x, window.innerWidth - 268));
  const top = Math.max(8, Math.min(point.y, window.innerHeight - 380));
  return createPortal(
    <div
      ref={menuRef}
      className="context-menu custom-context-menu"
      role="menu"
      aria-label={label}
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        "separator" in item ? (
          <div role="separator" key={`separator-${index}`} />
        ) : (
          <button
            type="button"
            role="menuitem"
            key={item.label}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export function InfiniteScrollSentinel({
  enabled,
  loading,
  onLoad,
}: {
  enabled: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !enabled ||
      loading ||
      !sentinel ||
      typeof IntersectionObserver === "undefined"
    )
      return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoad();
      },
      {
        root: sentinel.parentElement,
        rootMargin: "480px 0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, loading, onLoad]);

  if (!enabled) return null;
  return (
    <div
      ref={sentinelRef}
      className="infinite-scroll-sentinel"
      aria-live="polite"
      aria-label={loading ? "Loading more" : undefined}
    >
      {loading && <LoaderCircle className="spin" size={22} />}
    </div>
  );
}

const artworkPrefetches = new Set<AbortController>();
const artworkPrefetchSeen = new Set<string>();

export function cancelArtworkPrefetches() {
  artworkPrefetches.forEach((controller) => controller.abort());
  artworkPrefetches.clear();
  artworkPrefetchSeen.clear();
}

export async function prefetchArtwork(client: Navidrome, id?: string, imageUrl?: string, size = 400) {
  const src = client.cover(id, size) || imageUrl;
  if (!src) return;
  // Local files are already available through their object URL. Fetching them
  // again only creates another decoded/blob lifetime without warming a useful
  // HTTP cache.
  if (src.startsWith("blob:")) return;
  if (artworkPrefetchSeen.has(src)) return;
  artworkPrefetchSeen.add(src);
  // Warm HTTP cache only. Do not decode/retain a second image surface.
  const controller = new AbortController();
  artworkPrefetches.add(controller);
  try {
    const response = await fetch(src, {
      cache: "force-cache",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    // Prefetch is cache warming only. Close body stream; do not leave tab busy.
    await response.body?.cancel();
  } catch {
    // Preload optional; displayed artwork has retry path.
  } finally {
    artworkPrefetches.delete(controller);
  }
}

type SharedArtworkBlob = {
  refs: number;
  url: string;
  blob?: Blob;
  bytes: number;
  lastUsed: number;
  settled: boolean;
  discardWhenReleased?: boolean;
  release: () => void;
  promise: Promise<string>;
};
const sharedArtworkBlobs = new Map<string, SharedArtworkBlob>();
let sharedArtworkBytes = 0;
const MAX_SHARED_ARTWORK_BYTES = 32 * 1024 * 1024;

function evictSharedArtwork() {
  while (sharedArtworkBytes > MAX_SHARED_ARTWORK_BYTES) {
    const candidate = [...sharedArtworkBlobs.entries()]
      .filter(([, entry]) => entry.refs === 0 && entry.settled)
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)[0];
    if (!candidate) return;
    const [key, entry] = candidate;
    sharedArtworkBlobs.delete(key);
    sharedArtworkBytes -= entry.bytes;
    entry.blob = undefined;
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
}

function retainArtworkBlob(src: string, attempt: number): SharedArtworkBlob {
  const key = `${src}|${attempt}`;
  const existing = sharedArtworkBlobs.get(key);
  if (existing) {
    existing.refs++;
    existing.lastUsed = performance.now();
    return existing;
  }
  const controller = new AbortController();
  let url = "";
  const entry = {} as SharedArtworkBlob;
  entry.refs = 1;
  entry.bytes = 0;
  entry.lastUsed = performance.now();
  entry.settled = false;
  entry.promise = fetch(`${src}${src.includes("?") ? "&" : "?"}volta_retry=${attempt}`, {
    cache: "force-cache",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      entry.blob = blob;
      entry.bytes = blob.size;
      entry.settled = true;
      entry.lastUsed = performance.now();
      sharedArtworkBytes += entry.bytes;
      url = URL.createObjectURL(blob);
      entry.url = url;
      return url;
    })
    .finally(() => {
      if (entry.refs <= 0 && !entry.settled) {
        sharedArtworkBlobs.delete(key);
        controller.abort();
        if (url) URL.revokeObjectURL(url);
      }
      evictSharedArtwork();
    });
  entry.url = "";
  entry.release = () => {
    entry.refs--;
    if (entry.refs > 0) return;
    entry.lastUsed = performance.now();
    if (!entry.settled || entry.discardWhenReleased) {
      sharedArtworkBlobs.delete(key);
      sharedArtworkBytes -= entry.bytes;
      controller.abort();
      entry.blob = undefined;
      if (url) URL.revokeObjectURL(url);
    }
    evictSharedArtwork();
  };
  sharedArtworkBlobs.set(key, entry);
  return entry;
}

export function ArtworkMotionProvider({ enabled, everywhere, experimentalLoading, children }: {
  enabled: boolean; everywhere: boolean; children: ReactNode;
  experimentalLoading: boolean;
}) {
  const value = useMemo(() => ({ enabled, everywhere }), [enabled, everywhere]);
  return <ArtworkMotionContext.Provider value={{ ...value, experimentalLoading }}>{children}</ArtworkMotionContext.Provider>;
}

const ExperimentalArtwork = memo(function ExperimentalArtwork({
  id, imageUrl, client, size = 400, className = "", label = "", eager = false,
}: {
  id?: string; imageUrl?: string; client: Navidrome; size?: number;
  className?: string; label?: string; eager?: boolean;
}) {
  useEffect(() => {
    void prefetchArtwork(client, id, imageUrl, size);
  }, [client, id, imageUrl, size]);
  return <StandardArtwork {...{ id, imageUrl, client, size, className, label, eager }} />;
});

const ArtworkImage = memo(function ArtworkImage({
  src,
  alt,
  eager,
  active,
  discardAnimated,
  onType,
}: {
  src: string;
  alt: string;
  eager: boolean;
  active: boolean;
  discardAnimated: boolean;
  onType: (type: string, blob?: Blob) => Promise<string | null | undefined> | string | null | undefined;
}) {
  const [attempt, setAttempt] = useState(0);
  const [resolvedSrc, setResolvedSrc] = useState(() => src.startsWith("data:") ? src : "");
  useEffect(() => {
    setAttempt(0);
    setResolvedSrc(src.startsWith("data:") ? src : "");
  }, [src]);
  useEffect(() => {
    if (!active && !src.startsWith("data:")) {
      setResolvedSrc("");
      return;
    }
    if (src.startsWith("data:")) {
      return;
    }
    if (src.startsWith("blob:")) {
      let cancelled = false;
      const controller = new AbortController();
      void fetch(src, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Local artwork unavailable");
          return response.blob();
        })
        .then(async (blob) => {
          const replacement = await onType(blob.type, blob);
          if (!cancelled) setResolvedSrc(replacement || src);
        })
        .catch(() => {
          if (!cancelled) setResolvedSrc(src);
        });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    const shared = retainArtworkBlob(src, attempt);
    let retryTimer: number | undefined;
    shared.promise
      .then(async (objectUrl) => {
        if (!shared.blob) throw new Error("Artwork blob unavailable");
        if (discardAnimated && /image\/(gif|apng|webp)/i.test(shared.blob.type))
          shared.discardWhenReleased = true;
        const replacement = await onType(shared.blob.type, shared.blob);
        if (replacement !== undefined) {
          setResolvedSrc(replacement || "");
          return;
        }
        setResolvedSrc(objectUrl);
      })
      .catch(() => {
        if (attempt >= 3) return;
        retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), 250 * 2 ** attempt);
      });
    return () => {
      shared.release();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [active, attempt, onType, src]);
  return (
    <img
      src={active || src.startsWith("data:") ? resolvedSrc || undefined : undefined}
      alt={alt}
      loading={eager || attempt > 0 ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (attempt >= 3) return;
        setAttempt((value) => Math.min(3, value + 1));
      }}
    />
  );
});

const StandardArtwork = memo(function StandardArtwork({
  id, imageUrl, client, size = 400, className = "", label = "", eager = false,
}: { id?: string; imageUrl?: string; client: Navidrome; size?: number; className?: string; label?: string; eager?: boolean }) {
  const { enabled, everywhere } = useContext(ArtworkMotionContext);
  const original = imageUrl || client.cover(id);
  const resized = imageUrl || client.cover(id, size);
  const [kind, setKind] = useState<"animated" | "static" | undefined>(original ? undefined : "static");
  const [frozen, setFrozen] = useState("");
  const [near, setNear] = useState(eager);
  const artworkRef = useRef<HTMLDivElement>(null);
  const active = eager || near;
  const activeRef = useRef(active);
  const isLocalArtwork = imageUrl?.startsWith("blob:") || false;
  const animate = enabled && Boolean(original) && (eager || (everywhere && near));
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const handleArtworkType = useCallback((type: string, blob?: Blob) => {
    const animated = /image\/(gif|apng|webp)/i.test(type);
    setKind(animated ? "animated" : "static");
    if (animated && blob && !animate && resized) {
      return loadArtworkStill(resized, blob)
        .then((frame) => {
          if (!activeRef.current) {
            discardArtworkStill(resized);
            return null;
          }
          setFrozen(frame);
          return frame;
        })
        .catch(() => {
          setKind("static");
          return null;
        });
    }
    return undefined;
  }, [animate, resized]);
  useEffect(() => {
    if (!active || animate || kind !== "animated" || !resized) return;
    let cancelled = false;
    void loadArtworkStill(resized)
      .then((frame) => {
        if (!cancelled && activeRef.current) setFrozen(frame);
        else discardArtworkStill(resized);
      })
      .catch(() => {
        if (!cancelled) setKind("static");
      });
    return () => {
      cancelled = true;
    };
  }, [active, animate, kind, resized]);
  useEffect(() => {
    if (active || !frozen || !resized) return;
    discardArtworkStill(resized);
    setFrozen("");
  }, [active, frozen, resized]);
  useEffect(() => {
    setNear(eager);
    const element = artworkRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const mainContent = document.querySelector<HTMLElement>(".main-content");
    const root = mainContent?.contains(element) ? mainContent : null;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(Boolean(entry?.isIntersecting)),
      {
        root,
        // Local animated files can be substantially larger than server-sized
        // covers. Keep their decoded surfaces close to the viewport only.
        rootMargin: isLocalArtwork ? "96px" : "480px",
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, id, imageUrl]);
  // Grid: frozen frame only. Prominent views: original animation.
  // Keep loaded artwork visible while frame 2 is being extracted.
  // Swap to static frame only after extraction succeeds.
  const src = animate ? original : kind === "animated" ? frozen || resized : resized;
  return <div ref={artworkRef} data-artwork-id={id || imageUrl || ""} className={`artwork ${className}`}>
    {src ? <ArtworkImage src={src} alt={label} eager={eager} active={active} discardAnimated={!animate} onType={handleArtworkType} /> : <Music2 aria-hidden="true" />}
  </div>;
});

export const Artwork = memo(function Artwork(props: React.ComponentProps<typeof ExperimentalArtwork>) {
  const { experimentalLoading } = useContext(ArtworkMotionContext);
  return experimentalLoading ? <ExperimentalArtwork {...props} /> : <StandardArtwork {...props} />;
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
  }
>(function IconButton({ label, children, active, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-button${active ? " active" : ""}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
});

export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
  hideTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  hideTitle?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog ${className}`}
          aria-describedby={undefined}
        >
          <div className="dialog-heading">
            <Dialog.Title className={hideTitle ? "visually-hidden" : undefined}>
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SongMenu({
  song,
  onQueue,
  onFavorite,
  favorite,
  onAlbum,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: {
  song: Song;
  onQueue: (song: Song, next?: boolean) => void;
  onFavorite: (song: Song) => void;
  favorite: boolean;
  onAlbum?: (id: string) => void;
  onAddToPlaylist?: (song: Song) => void;
  onRemoveFromPlaylist?: () => void;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <IconButton label={`Options for ${song.title}`}>
          <Ellipsis size={18} />
        </IconButton>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="context-menu" sideOffset={5} align="end">
          <Dropdown.Item onSelect={() => onQueue(song, true)}>
            <ListPlus size={16} />
            Play Next
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => onQueue(song)}>
            <ListEnd size={16} />
            Play Last
          </Dropdown.Item>
          <Dropdown.Separator />
          {onAddToPlaylist && (
            <Dropdown.Item onSelect={() => onAddToPlaylist(song)}>
              <ListMusic size={16} />
              Add to Playlist
            </Dropdown.Item>
          )}
          <Dropdown.Item onSelect={() => onFavorite(song)}>
            <Star size={16} />
            {favorite ? "Remove Favorite" : "Favorite"}
          </Dropdown.Item>
          {onRemoveFromPlaylist && (
            <Dropdown.Item onSelect={onRemoveFromPlaylist}>
              <X size={16} />
              Remove from Playlist
            </Dropdown.Item>
          )}
          {song.albumId && onAlbum && (
            <Dropdown.Item onSelect={() => onAlbum(song.albumId!)}>
              <Disc3 size={16} />
              Go to Album
            </Dropdown.Item>
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export const AlbumGrid = memo(function AlbumGrid({
  albums,
  client,
  onOpen,
  onPlay,
  onContextMenu,
  shelf = false,
  featured = false,
  resultNavigation = false,
}: {
  albums: AlbumRecord[];
  client: Navidrome;
  onOpen: (album: AlbumRecord) => void;
  onPlay: (album: AlbumRecord) => void;
  onContextMenu?: (event: ReactMouseEvent, album: AlbumRecord) => void;
  shelf?: boolean;
  featured?: boolean;
  resultNavigation?: boolean;
}) {
  const { experimentalLoading } = useContext(ArtworkMotionContext);
  const warmArtwork = () => {
    if (!experimentalLoading) return;
    albums.slice(0, shelf ? 12 : 18).forEach((album) =>
      prefetchArtwork(
        client,
        album.coverArt,
        album.localArtworkUrl,
        featured ? 600 : 400,
      ),
    );
  };
  return (
    <div
      className={`album-grid ${shelf ? "shelf-grid" : ""} ${featured ? "featured-grid" : ""}`}
      onPointerEnter={warmArtwork}
      onFocus={warmArtwork}
    >
      {albums.map((album) => (
        <article
          className="album-card"
          key={album.id}
          onContextMenu={(event) => onContextMenu?.(event, album)}
        >
          <div className="album-image">
            <button
              className="artwork-link"
              data-search-result={resultNavigation ? true : undefined}
              aria-label={`Open ${albumName(album)}`}
              onClick={() => onOpen(album)}
            >
              <Artwork
                client={client}
                id={album.coverArt}
                imageUrl={album.localArtworkUrl}
                size={featured ? 600 : 400}
              />
            </button>
            <button
              className="artwork-play"
              data-search-result={resultNavigation ? true : undefined}
              aria-label={`Play ${albumName(album)}`}
              onClick={() => onPlay(album)}
            >
              <Play size={20} fill="currentColor" />
            </button>
          </div>
          <button className="album-caption" onClick={() => onOpen(album)}>
            <span>{albumName(album)}</span>
            <small>{album.artist || "Unknown artist"}</small>
          </button>
        </article>
      ))}
    </div>
  );
});

export const TrackTable = memo(function TrackTable({
  songs,
  client,
  currentId,
  playing,
  onPlay,
  onQueue,
  onFavorite,
  isFavorite,
  onAlbum,
  onContextMenu,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  compact = false,
  resultNavigation = false,
}: {
  songs: Song[];
  client: Navidrome;
  currentId?: string;
  playing: boolean;
  onPlay: (songs: Song[], index: number) => void;
  onQueue: (song: Song, next?: boolean) => void;
  onFavorite: (song: Song) => void;
  isFavorite: (song: Song) => boolean;
  onAlbum: (id: string) => void;
  onContextMenu?: (event: ReactMouseEvent, song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song, index: number) => void;
  compact?: boolean;
  resultNavigation?: boolean;
}) {
  return (
    <div className={`track-table ${compact ? "album-tracks" : ""}`}>
      {!compact && (
        <div className="track-table-heading">
          <span>#</span>
          <span>Title</span>
          <span className="track-album-column">Album</span>
          <span className="track-format-column">Quality</span>
          <span>Time</span>
          <span />
        </div>
      )}
      {songs.map((song, index) => (
        <div
          className={`song-row ${currentId === song.id ? "current" : ""}`}
          key={`${song.id}-${index}`}
          onContextMenu={(event) => onContextMenu?.(event, song)}
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button")
            )
              return;
              onPlay(songs, index);
          }}
        >
          <button
            className="song-number"
            onClick={() => onPlay(songs, index)}
            aria-label={`Play ${song.title}`}
          >
            {currentId === song.id && playing ? (
              <span className="playing-indicator" aria-label="Playing">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <>
                <span>{song.track && compact ? song.track : index + 1}</span>
                <Play size={13} fill="currentColor" />
              </>
            )}
          </button>
          <button
            className="song-title"
            data-search-result={resultNavigation ? true : undefined}
            onClick={() => onPlay(songs, index)}
          >
            {!compact && (
              <Artwork
                client={client}
                id={song.coverArt}
                imageUrl={song.localArtworkUrl}
                size={80}
              />
            )}
            <span>
              <b>{song.title}</b>
              {!compact && <small>{song.artist || "Unknown artist"}</small>}
            </span>
            {isFavorite(song) && <Star size={12} fill="currentColor" />}
          </button>
          {!compact && (
            <>
              <button
                className="track-album-column"
                disabled={!song.albumId}
                onClick={() => song.albumId && onAlbum(song.albumId)}
              >
                {song.album || "—"}
              </button>
              <span className="track-format-column">
                {isLossless(song)
                  ? "Lossless"
                  : song.suffix?.toUpperCase() || "—"}
              </span>
            </>
          )}
          <span className="song-duration">{duration(song.duration)}</span>
          <SongMenu
            song={song}
            onQueue={onQueue}
            onFavorite={onFavorite}
            favorite={isFavorite(song)}
            onAlbum={onAlbum}
            onAddToPlaylist={onAddToPlaylist}
            onRemoveFromPlaylist={
              onRemoveFromPlaylist
                ? () => onRemoveFromPlaylist(song, index)
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
});

export function EmptyState({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Music2 size={42} strokeWidth={1.3} />
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-label="Loading library">
      <div className="skeleton-heading" />
      <div className="skeleton-grid">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index}>
            <i />
            <b />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
