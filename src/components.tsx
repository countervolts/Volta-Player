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
  useLayoutEffect,
  useRef,
  useState,
  cloneElement,
  useId,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Disc3,
  Ellipsis,
  GripVertical,
  ListEnd,
  ListMusic,
  ListPlus,
  LoaderCircle,
  Music2,
  Play,
  Share2,
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
      disabled?: boolean;
    }
  | { separator: true };

export function ContextMenu({
  point,
  items,
  label,
  onClose,
  container,
}: {
  point: { x: number; y: number } | null;
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
  container?: Element | null;
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
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
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
    container ?? document.body,
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

type TooltipChildProps = {
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
};

let pointerMoveVersion = 0;
let pointerTrackerAttached = false;
const ensurePointerTracker = () => {
  if (pointerTrackerAttached || typeof window === "undefined") return;
  pointerTrackerAttached = true;
  window.addEventListener(
    "pointermove",
    () => {
      pointerMoveVersion += 1;
    },
    { passive: true },
  );
};

function useTooltip(label: string) {
  const tooltipId = useId();
  const mountedPointerVersion = useRef(pointerMoveVersion);
  const [state, setState] = useState<"closed" | "open" | "leaving">("closed");
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    bottom: 0,
    placement: "above" as "above" | "below",
  });
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (leaveTimer.current !== undefined) window.clearTimeout(leaveTimer.current);
  }, []);

  const show = useCallback((target: HTMLElement) => {
    if (leaveTimer.current !== undefined) window.clearTimeout(leaveTimer.current);
    const rect = target.getBoundingClientRect();
    setPosition({
      left: Math.max(14, Math.min(window.innerWidth - 14, rect.left + rect.width / 2)),
      top: Math.max(8, rect.top - 8),
      bottom: rect.bottom + 8,
      placement: "above",
    });
    setState("open");
  }, []);

  useLayoutEffect(() => {
    if (state === "closed" || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    setPosition((current) => {
      const left = Math.max(
        rect.width / 2 + 8,
        Math.min(window.innerWidth - rect.width / 2 - 8, current.left),
      );
      const placement = current.placement === "above" && rect.top < 8
        ? "below"
        : current.placement;
      const top = placement === "below" ? current.bottom : current.top;
      if (
        left === current.left &&
        top === current.top &&
        placement === current.placement
      )
        return current;
      return { ...current, left, top, placement };
    });
  }, [state, position.left, position.placement]);

  const hide = useCallback(() => {
    if (state === "closed") return;
    setState("leaving");
    leaveTimer.current = window.setTimeout(() => setState("closed"), 150);
  }, [state]);

  const dismiss = useCallback(() => {
    if (leaveTimer.current !== undefined) window.clearTimeout(leaveTimer.current);
    setState("closed");
  }, []);

  useEffect(() => {
    ensurePointerTracker();
    const dismissOnWindowLeave = () => dismiss();
    const dismissWhenHidden = () => {
      if (document.visibilityState !== "visible") dismiss();
    };
    window.addEventListener("blur", dismissOnWindowLeave);
    document.addEventListener("visibilitychange", dismissWhenHidden);
    return () => {
      window.removeEventListener("blur", dismissOnWindowLeave);
      document.removeEventListener("visibilitychange", dismissWhenHidden);
    };
  }, [dismiss]);

  const getTriggerProps = useCallback(
    (existing: TooltipChildProps) => ({
      "aria-describedby": state === "open"
        ? existing["aria-describedby"] || tooltipId
        : existing["aria-describedby"],
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        existing.onBlur?.(event);
        hide();
      },
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        // A control can disappear immediately after activation (notably the
        // full-player close button), so do not leave an exit portal behind.
        dismiss();
        existing.onClick?.(event);
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        existing.onFocus?.(event);
        // Radix focuses the fullscreen Close button when the dialog opens.
        // That is programmatic focus, not an intentional keyboard hover.
        if (event.currentTarget.matches(":focus-visible"))
          show(event.currentTarget);
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        dismiss();
        existing.onPointerDown?.(event);
      },
      onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
        existing.onPointerEnter?.(event);
        // A fullscreen surface can mount beneath a stationary pointer. Do
        // not treat that layout change as a fresh hover; wait for movement.
        if (pointerMoveVersion === mountedPointerVersion.current) return;
        show(event.currentTarget);
      },
      onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
        existing.onPointerLeave?.(event);
        hide();
      },
    }),
    [dismiss, hide, show, state, tooltipId],
  );

  const tooltip = state === "closed"
    ? null
    : createPortal(
        <span
          ref={tooltipRef}
          className="volta-tooltip"
          data-placement={position.placement}
          data-state={state === "open" ? "open" : "closed"}
          id={tooltipId}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
        >
          {label}
        </span>,
        document.body,
      );

  return { getTriggerProps, tooltip };
}

export function Tooltip({
  label,
  children,
}: {
  label?: string;
  children: ReactElement;
}) {
  if (!label) return children;
  const { getTriggerProps, tooltip } = useTooltip(label);
  const trigger = cloneElement(
    children,
    getTriggerProps(children.props as TooltipChildProps),
  );
  return (
    <>
      {trigger}
      {tooltip}
    </>
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
        if (sharedArtworkBlobs.get(key) === entry) sharedArtworkBlobs.delete(key);
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
      if (sharedArtworkBlobs.get(key) === entry) {
        sharedArtworkBlobs.delete(key);
        sharedArtworkBytes -= entry.bytes;
      }
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
  loadEager = false,
}: {
  id?: string; imageUrl?: string; client: Navidrome; size?: number;
  className?: string; label?: string; eager?: boolean; loadEager?: boolean;
}) {
  useEffect(() => {
    void prefetchArtwork(client, id, imageUrl, size);
  }, [client, id, imageUrl, size]);
  return <StandardArtwork {...{ id, imageUrl, client, size, className, label, eager, loadEager }} />;
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
    let cancelled = false;
    let retryTimer: number | undefined;
    shared.promise
      .then(async (objectUrl) => {
        if (cancelled) return;
        if (!shared.blob) throw new Error("Artwork blob unavailable");
        if (discardAnimated && /image\/(gif|apng|webp)/i.test(shared.blob.type))
          shared.discardWhenReleased = true;
        const replacement = await onType(shared.blob.type, shared.blob);
        if (cancelled) return;
        if (replacement !== undefined) {
          setResolvedSrc(replacement || "");
          return;
        }
        setResolvedSrc(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        if (attempt >= 3) return;
        retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), 250 * 2 ** attempt);
      });
    return () => {
      cancelled = true;
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
  loadEager = false,
}: { id?: string; imageUrl?: string; client: Navidrome; size?: number; className?: string; label?: string; eager?: boolean; loadEager?: boolean }) {
  const { enabled, everywhere } = useContext(ArtworkMotionContext);
  const original = imageUrl || client.cover(id);
  const resized = imageUrl || client.cover(id, size);
  const [kind, setKind] = useState<"animated" | "static" | undefined>(original ? undefined : "static");
  const [frozen, setFrozen] = useState("");
  const [near, setNear] = useState(eager || loadEager);
  const artworkRef = useRef<HTMLDivElement>(null);
  const active = eager || loadEager || near;
  const activeRef = useRef(active);
  const artworkSourceRef = useRef(resized);
  artworkSourceRef.current = resized;
  const isLocalArtwork = imageUrl?.startsWith("blob:") || false;
  const animate = enabled && Boolean(original) && (eager || (everywhere && near));
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const handleArtworkType = useCallback((type: string, blob?: Blob) => {
    // A keyed card can be reused as Home and New in Your Library swap their
    // overlapping albums. Ignore a completion belonging to the old URL.
    if (artworkSourceRef.current !== resized) return undefined;
    const animated = /image\/(gif|apng|webp)/i.test(type);
    setKind(animated ? "animated" : "static");
    if (animated && blob && !animate && resized) {
      return loadArtworkStill(resized, blob)
        .then((frame) => {
          if (artworkSourceRef.current !== resized || !activeRef.current) {
            discardArtworkStill(resized);
            return null;
          }
          setFrozen(frame);
          return frame;
        })
        .catch(() => {
          // No usable still (e.g. Firefox RFP poisons canvas readback). Fall
          // back to the original blob URL, which renders the first frame.
          if (artworkSourceRef.current === resized) setKind("static");
          return undefined;
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
    setNear(eager || loadEager);
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
  }, [eager, id, imageUrl, loadEager]);
  useEffect(() => {
    setKind(original ? undefined : "static");
    setFrozen("");
  }, [original, resized]);
  // Grid: frozen frame only. Prominent views: original animation.
  // Keep loaded artwork visible while frame 2 is being extracted.
  // Swap to static frame only after extraction succeeds.
  const src = animate ? original : kind === "animated" ? frozen || resized : resized;
  return <div ref={artworkRef} data-artwork-id={id || imageUrl || ""} className={`artwork ${className}`}>
    {src ? <ArtworkImage key={src} src={src} alt={label} eager={eager || loadEager} active={active} discardAnimated={!animate} onType={handleArtworkType} /> : <Music2 aria-hidden="true" />}
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
    tooltip?: string;
  }
>(function IconButton({ label, children, active, tooltip, title: _nativeTitle, ...props }, ref) {
  const { getTriggerProps, tooltip: tooltipContent } = useTooltip(tooltip || label);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`icon-button${active ? " active" : ""}`}
        aria-label={label}
        {...props}
        {...getTriggerProps(props as TooltipChildProps)}
      >
        {children}
      </button>
      {tooltipContent}
    </>
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
  onShare,
}: {
  song: Song;
  onQueue: (song: Song, next?: boolean) => void;
  onFavorite: (song: Song) => void;
  favorite: boolean;
  onAlbum?: (id: string) => void;
  onAddToPlaylist?: (song: Song) => void;
  onRemoveFromPlaylist?: () => void;
  onShare?: (song: Song) => void;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <IconButton label={`Options for ${song.title}`}>
          <Ellipsis size={18} />
        </IconButton>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="context-menu"
          sideOffset={5}
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
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
          {onShare && (
            <Dropdown.Item onSelect={() => onShare(song)}>
              <Share2 size={16} />
              Copy Share Link
            </Dropdown.Item>
          )}
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
                loadEager={shelf || featured}
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
  onShare,
  compact = false,
  resultNavigation = false,
  selecting = false,
  selectedIndexes,
  onToggleSelect,
  onToggleSelectAll,
  onReorder,
  reordered,
  playlistView = false,
}: {
  songs: Song[];
  client: Navidrome;
  currentId?: string;
  playing: boolean;
  onPlay: (songs: Song[], index: number, restart?: boolean) => void;
  onQueue: (song: Song, next?: boolean) => void;
  onFavorite: (song: Song) => void;
  isFavorite: (song: Song) => boolean;
  onAlbum: (id: string) => void;
  onContextMenu?: (event: ReactMouseEvent, song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song, index: number) => void;
  onShare?: (song: Song) => void;
  compact?: boolean;
  resultNavigation?: boolean;
  selecting?: boolean;
  selectedIndexes?: Set<number>;
  onToggleSelect?: (index: number, shiftKey: boolean) => void;
  onToggleSelectAll?: () => void;
  /** When provided, rows can be dragged to change playlist order. */
  onReorder?: (fromIndex: number, toIndex: number) => void;
  reordered?: boolean;
  /** Playlist rows are numbered by playlist order, not album track number. */
  playlistView?: boolean;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const dragState = useRef<{ from: number; to: number } | null>(null);
  const beginReorder =
    (index: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!onReorder) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragState.current = { from: index, to: index };
      setDragFrom(index);
      setDragTo(index);
    };
  const updateReorder = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state) return;
    event.preventDefault();
    const table = event.currentTarget.closest(".track-table");
    if (!table) return;
    let target = state.to;
    Array.from(table.querySelectorAll<HTMLElement>(".song-row")).forEach(
      (row, index) => {
        const rect = row.getBoundingClientRect();
        if (event.clientY >= rect.top && event.clientY <= rect.bottom)
          target = index;
      },
    );
    state.to = target;
    setDragTo(target);
  };
  const endReorder = () => {
    const state = dragState.current;
    dragState.current = null;
    setDragFrom(null);
    setDragTo(null);
    if (!state || state.from === state.to) return;
    onReorder?.(state.from, state.to);
  };
  const allSelected =
    selecting && songs.length > 0 && selectedIndexes?.size === songs.length;
  return (
    <div
      className={
        "track-table" +
        (compact ? " album-tracks" : "") +
        (playlistView ? " playlist-tracks" : "") +
        (selecting ? " selecting" : "")
      }
    >
      {!compact && (
        <div className="track-table-heading">
          {selecting && (
            <span className="track-select-cell">
              <input
                type="checkbox"
                aria-label={allSelected ? "Deselect all songs" : "Select all songs"}
                checked={Boolean(allSelected)}
                onChange={() => onToggleSelectAll?.()}
              />
            </span>
          )}
          <span>#</span>
          <span>Title</span>
          <span className="track-album-column">Album</span>
          <span className="track-format-column">Quality</span>
          <span>Time</span>
          <span />
        </div>
      )}
      {songs.map((song, index) => {
        const selected = Boolean(selecting && selectedIndexes?.has(index));
        return (
        <div
          className={
            `song-row ${currentId === song.id ? "current" : ""}` +
            (selected ? " selected" : "") +
            (reordered ? " reorderable" : "") +
            (dragFrom === index ? " is-dragging" : "") +
            (dragTo === index && dragFrom !== null ? " is-drag-over" : "")
          }
          key={`${song.id}-${index}`}
          onContextMenu={(event) => onContextMenu?.(event, song)}
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button, input")
            )
              return;
              if (selecting) onToggleSelect?.(index, event.shiftKey);
              else onPlay(songs, index);
          }}
        >
          {reordered && (
            <button
              type="button"
              className="song-drag-handle"
              aria-label={`Reorder ${song.title}`}
              onPointerDown={beginReorder(index)}
              onPointerMove={updateReorder}
              onPointerUp={endReorder}
              onPointerCancel={endReorder}
            >
              <GripVertical size={14} />
            </button>
          )}
          {selecting && (
            <span
              className="track-select-cell"
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect?.(index, event.shiftKey);
              }}
            >
              <input
                type="checkbox"
                aria-label={`Select ${song.title}`}
                checked={selected}
                readOnly
                tabIndex={-1}
              />
            </span>
          )}
          <button
            className="song-number"
            onClick={() =>
              selecting ? onToggleSelect?.(index, false) : onPlay(songs, index)
            }
            onDoubleClick={() => !selecting && onPlay(songs, index, true)}
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
                <span>
                  {song.track && compact && !playlistView
                    ? song.track
                    : index + 1}
                </span>
                <Play size={13} fill="currentColor" />
              </>
            )}
          </button>
          <button
            className="song-title"
            data-search-result={resultNavigation ? true : undefined}
            onClick={() =>
              selecting ? onToggleSelect?.(index, false) : onPlay(songs, index)
            }
            onDoubleClick={() => !selecting && onPlay(songs, index, true)}
          >
            {(!compact || playlistView) && (
              <Artwork
                client={client}
                id={song.coverArt}
                imageUrl={song.localArtworkUrl}
                size={80}
              />
            )}
            <span>
              <b>{song.title}</b>
              {(!compact || playlistView) && (
                <small>{song.artist || "Unknown artist"}</small>
              )}
            </span>
            {isFavorite(song) && <Star size={12} fill="currentColor" />}
          </button>
          {!compact && (
            <>
              <button
                className="track-album-column"
                disabled={!song.albumId}
                onClick={(event) => {
                  event.stopPropagation();
                  if (song.albumId) onAlbum(song.albumId);
                }}
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
            onShare={onShare}
            onRemoveFromPlaylist={
              onRemoveFromPlaylist
                ? () => onRemoveFromPlaylist(song, index)
                : undefined
            }
          />
        </div>
      );
      })}
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
