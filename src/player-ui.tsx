import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  AudioLines,
  ClipboardPaste,
  Clock3,
  Copy,
  Expand,
  GripVertical,
  Infinity,
  ListMusic,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  Artwork,
  ContextMenu,
  IconButton,
  Modal,
  type ContextMenuItem,
} from "./components";
import { FrameMonitor } from "./app/frame-monitor";
import {
  duration,
  isLocalSong,
  isLossless,
  parseLyricsText,
  type Lyrics,
  type LyricsLine,
  type LyricsWord,
  type Navidrome,
  type Song,
} from "./lib/navidrome";
import { type Player } from "./lib/use-player";

function quality(
  song: Song | undefined,
  activeStream: "original" | "compatible",
) {
  if (activeStream === "compatible") return "MP3 320 kbps";
  if (!song) return "Original Quality";
  if (!isLossless(song)) return "Original";
  return (song.bitDepth || 0) > 16 || (song.samplingRate || 0) > 48000
    ? "Hi-Res Lossless"
    : "Lossless";
}

const playerAlbumArtworkCache = new Map<string, string>();

/**
 * The "Mixing" badge shows on Now Playing while AutoMix is
 * blending two tracks. The reason text is exposed to assistive technology
 * rather than being a second visible line, so the dock does not reflow.
 */
export function MixingIndicator({ label }: { label: string }) {
  return (
    <span className="mixing-indicator" data-testid="mixing-indicator">
      <span className="mixing-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="mixing-label">Mixing</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function adjustVolumeFromWheel(
  event: ReactWheelEvent<HTMLDivElement>,
  player: Player,
) {
  if (!event.deltaY) return;
  event.preventDefault();
  event.stopPropagation();
  const step = event.deltaY < 0 ? 0.05 : -0.05;
  player.setVolume(Math.round((player.volume + step) * 100) / 100);
}

function usePlayerArtwork(client: Navidrome, song?: Song): string | undefined {
  const local = isLocalSong(song);
  const albumId = local ? undefined : song?.albumId;
  const cacheKey = albumId ? `${client.server}:${albumId}` : "";
  const [resolved, setResolved] = useState<{
    key: string;
    coverArt?: string;
  }>();
  const cachedArtwork = cacheKey
    ? playerAlbumArtworkCache.get(cacheKey)
    : undefined;
  const resolvedArtwork =
    cachedArtwork ??
    (resolved?.key === cacheKey ? resolved.coverArt : undefined);

  useEffect(() => {
    if (!albumId || !cacheKey || playerAlbumArtworkCache.has(cacheKey)) return;
    const controller = new AbortController();
    void client
      .album(albumId, controller.signal)
      .then((album) => {
        if (!album.coverArt) return;
        playerAlbumArtworkCache.set(cacheKey, album.coverArt);
        setResolved({ key: cacheKey, coverArt: album.coverArt });
      })
      .catch(() => {
        // Track artwork remains a safe fallback when an album cannot be read.
      });
    return () => controller.abort();
  }, [albumId, cacheKey, client]);

  return local ? song?.localArtworkUrl : resolvedArtwork ?? song?.coverArt;
}

function Transport({
  player,
  large = false,
}: {
  player: Player;
  large?: boolean;
}) {
  return (
    <div className={"transport-controls" + (large ? " large" : "")}>
      <IconButton
        label="Shuffle"
        aria-pressed={player.shuffle}
        active={player.shuffle}
        disabled={!player.queue.length}
        onClick={player.toggleShuffle}
      >
        <Shuffle size={16} />
      </IconButton>
      <IconButton
        label="Previous track"
        disabled={!player.currentSong}
        onClick={player.previous}
      >
        <SkipBack size={20} fill="currentColor" />
      </IconButton>
      <IconButton
        label={player.playing ? "Pause" : "Play"}
        disabled={!player.currentSong}
        onClick={player.toggle}
      >
        {player.loading ? (
          <LoaderCircle className="spin" size={23} />
        ) : player.playing ? (
          <Pause size={24} fill="currentColor" />
        ) : (
          <Play size={24} fill="currentColor" />
        )}
      </IconButton>
      <IconButton
        label="Next track"
        disabled={!player.currentSong}
        onClick={player.next}
      >
        <SkipForward size={20} fill="currentColor" />
      </IconButton>
      <IconButton
        label={"Repeat: " + player.repeat}
        active={player.repeat !== "off"}
        disabled={!player.queue.length}
        onClick={player.cycleRepeat}
      >
        {player.repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
      </IconButton>
    </div>
  );
}

function Seek({
  player,
  times = false,
  hoverTimes = false,
}: {
  player: Player;
  times?: boolean;
  hoverTimes?: boolean;
}) {
  const showTimes = times || hoverTimes;
  return (
    <div
      className={
        "seek-control" +
        (times ? " show-times" : "") +
        (hoverTimes ? " hover-times" : "")
      }
    >
      {showTimes && <span>{duration(player.currentTime)}</span>}
      <input
        aria-label="Playback position"
        type="range"
        min={0}
        max={player.duration || 1}
        step={0.1}
        value={Math.min(player.currentTime, player.duration || 1)}
        disabled={!player.currentSong}
        onChange={(event) => player.seek(Number(event.target.value))}
        style={
          {
            "--progress":
              (player.currentTime / (player.duration || 1)) * 100 + "%",
          } as CSSProperties
        }
      />
      {showTimes && (
        <span>
          -{duration(Math.max(0, player.duration - player.currentTime))}
        </span>
      )}
    </div>
  );
}

function VolumeControl({
  player,
  fullscreen = false,
}: {  player: Player;
  fullscreen?: boolean;
}) {
  const percentage = Math.round(player.volume * 100);
  const className = fullscreen ? "fullscreen-volume" : "dock-volume";

  return (
    <div
      className={className}
      onWheel={(event) => adjustVolumeFromWheel(event, player)}
    >
      <IconButton
        label={player.muted ? "Unmute" : "Mute"}
        onClick={player.toggleMute}
      >
        {!player.muted ? (
          <Volume2 size={fullscreen ? 18 : 19} />
        ) : (
          <VolumeX size={fullscreen ? 18 : 19} />
        )}
      </IconButton>
      <div
        className="volume-slider"
        style={{ "--volume-position": percentage + "%" } as CSSProperties}
      >
        <span className="volume-value" aria-hidden="true">
          {percentage}%
        </span>
        <input
          aria-label={fullscreen ? "Fullscreen volume" : "Volume"}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          style={{ "--progress": player.volume * 100 + "%" } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function PlaybackDock({
  client,
  player,
  panel,
  onPanel,
  onExpand,
  infinitePlayEnabled,
  onToggleInfinitePlay,
  infinitePlayBusy,
  onFavorite,
  favorite,
}: {
  client: Navidrome;
  player: Player;
  panel: "queue" | "lyrics" | null;
  onPanel: (panel: "queue" | "lyrics") => void;
  onExpand: () => void;
  infinitePlayEnabled: boolean;
  onToggleInfinitePlay: () => void;
  infinitePlayBusy: boolean;
  onFavorite: (song: Song) => void;
  favorite: boolean;
}) {
  const song = player.currentSong;
  return (
    <section className="playback-dock" aria-label="Music player">
      <Transport player={player} />
      <div className="dock-now-playing">
        <button
          className="dock-artwork"
          disabled={!song}
          onClick={onExpand}
          aria-label="Open Now Playing"
        >
          <Artwork
            client={client}
            id={song?.coverArt}
            imageUrl={song?.localArtworkUrl}
            size={100}
            eager
          />
        </button>
        <div className="dock-song">
          <button disabled={!song} onClick={onExpand}>
            <b>{song?.title || "Volta"}</b>
            <span>
              {song
                ? (song.artist || "Unknown artist") +
                  (song.album ? " — " + song.album : "")
                : "Choose something to play"}
            </span>
          </button>
          {player.automixLabel ? (
            <MixingIndicator label={player.automixLabel} />
          ) : null}
          <Seek player={player} hoverTimes />
        </div>
        <IconButton
          label="Favorite current song"
          aria-pressed={favorite}
          active={favorite}
          disabled={!song}
          onClick={() => song && onFavorite(song)}
        >
          <Star size={17} fill={favorite ? "currentColor" : "none"} />
        </IconButton>
      </div>
      <div className="dock-actions">
        <IconButton
          label={infinitePlayBusy ? "Adding songs to queue" : "Infinite Play"}
          active={infinitePlayEnabled}
          aria-pressed={infinitePlayEnabled}
          disabled={infinitePlayBusy}
          onClick={onToggleInfinitePlay}
        >
          <Infinity size={19} />
        </IconButton>
        <IconButton
          label="Lyrics"
          active={panel === "lyrics"}
          aria-pressed={panel === "lyrics"}
          onClick={() => onPanel("lyrics")}
        >
          <MessageSquareText size={18} />
        </IconButton>
        <IconButton
          label="Playing Next"
          active={panel === "queue"}
          aria-pressed={panel === "queue"}
          onClick={() => onPanel("queue")}
        >
          <ListMusic size={19} />
        </IconButton>
        <VolumeControl player={player} />
        <IconButton label="Expand player" disabled={!song} onClick={onExpand}>
          <Expand size={17} />
        </IconButton>
      </div>
    </section>
  );
}

/**
 * A line is marked current a touch before its own timestamp so the first word
 * is already moving as the line becomes current.
 */
const LYRIC_LINE_LEAD_SECONDS = 0.25;
/** The soft front of the fill, as a percentage of the glyph box. */
const LYRIC_FILL_SPREAD = 20;
/** Only words at least this long are split up and popped letter by letter. */
const LYRIC_EMPHASIS_MIN_SECONDS = 1;
const LYRIC_EMPHASIS_MAX_LETTERS = 7;
/** How long the list takes to glide the current line back to centre. */
const LYRIC_SCROLL_MS = 350;
/**
 * Cap on how far the lyric clock may run past the last real sample.
 *
 * The decoder reports its position in coarse steps, so between samples the
 * clock is advanced by wall-clock time. Bounding that lead keeps a stalled or
 * paused decoder from letting the fill run away.
 */
const LYRIC_CLOCK_MAX_LEAD = 0.25;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
/** How far `time` has travelled through `[from, to]`, clamped to 0..1. */
const ramp = (from: number, to: number, time: number) =>
  clamp01((time - from) / Math.max(0.001, to - from));

const LYRIC_PROGRESS_PROPERTIES = [
  "--lyric-progress",
  "--lyric-lift",
  "--lyric-scale",
  "--lyric-glow-blur",
  "--lyric-glow-alpha",
];

/**
 * Paint the fill for whichever line is current, and return it.
 *
 * The fill is driven per frame rather than with CSS keyframes, because the
 * timing comes from the audio and has to survive seeks and rate changes. React
 * state is too coarse to reuse here — it is quantised to a quarter second, and
 * re-rendering the list sixty times a second would be wasteful — so the custom
 * properties are written straight onto the DOM, for the current line only.
 */
function paintLyrics(
  root: HTMLElement,
  time: number,
  reduced: boolean,
): HTMLElement | null {
  const lines = root.querySelectorAll<HTMLElement>("[data-line-start]");
  let current: HTMLElement | null = null;
  for (const line of lines) {
    const start = Number(line.dataset.lineStart);
    if (Number.isFinite(start) && start <= time + LYRIC_LINE_LEAD_SECONDS)
      current = line;
  }
  for (const line of lines) {
    const isCurrent = line === current;
    if (line.hasAttribute("data-lyric-current") === isCurrent) continue;
    if (isCurrent) {
      line.setAttribute("data-lyric-current", "");
      continue;
    }
    // Drop the fill the last pass left behind, or seeking backwards would
    // leave the line it painted lit up.
    line.removeAttribute("data-lyric-current");
    for (const word of line.querySelectorAll<HTMLElement>(
      "[data-word-start], [data-letter-count]",
    )) {
      for (const property of LYRIC_PROGRESS_PROPERTIES)
        word.style.removeProperty(property);
    }
  }
  if (!current) return null;
  for (const word of current.querySelectorAll<HTMLElement>("[data-word-start]")) {
    const start = Number(word.dataset.wordStart);
    const end = Number(word.dataset.wordEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const duration = Math.max(0, end - start);
    const letters = word.querySelectorAll<HTMLElement>("[data-letter-count]");
    if (!letters.length) {
      word.style.setProperty(
        "--lyric-progress",
        `${mix(-LYRIC_FILL_SPREAD, 100, ramp(start, start + duration, time))}%`,
      );
      // A sung word settles two pixels high and stays there.
      word.style.setProperty(
        "--lyric-lift",
        `${mix(0, -2, ramp(start + 0.1, start + 0.1 + duration, time))}px`,
      );
      continue;
    }
    // An emphasised word is split per character, each letter running its own
    // half-second pop followed by a half-second settle. A held word is where
    // this reads most clearly: the letters light up one after another across
    // the whole length of the note.
    const slice = duration / letters.length;
    letters.forEach((letter, index) => {
      const from = start + slice * index;
      const rise = ramp(from, from + 0.5, time);
      const settle = ramp(from + 0.5, from + 1, time);
      const rising = time < from + 0.5;
      letter.style.setProperty(
        "--lyric-progress",
        `${rising ? mix(-LYRIC_FILL_SPREAD, 90, rise) : mix(90, 100, settle)}%`,
      );
      letter.style.setProperty(
        "--lyric-lift",
        `${rising ? mix(0, -2.05, rise) : mix(-2.05, -2, settle)}px`,
      );
      if (reduced) return;
      letter.style.setProperty(
        "--lyric-scale",
        String(rising ? mix(1, 1.05, rise) : mix(1.05, 1, settle)),
      );
      letter.style.setProperty(
        "--lyric-glow-blur",
        `${rising ? mix(0, 10, rise) : mix(10, 4, settle)}px`,
      );
      letter.style.setProperty(
        "--lyric-glow-alpha",
        String(rising ? mix(0, 0.4, rise) : mix(0.4, 0, settle)),
      );
    });
  }
  return current;
}

/**
 * Glide the list so `element` sits in the middle.
 *
 * The list is scrolled by animating `scrollTop` with an ease-in-out over a
 * fixed 350ms rather than leaving it to the browser's smooth scrolling, which
 * restarts from wherever it happens to be and reads as jumpy on long lines.
 */
function scrollLyricIntoView(
  root: HTMLElement,
  element: HTMLElement,
  reduced: boolean,
) {
  const rootBox = root.getBoundingClientRect();
  const lineBox = element.getBoundingClientRect();
  const target =
    root.scrollTop +
    (lineBox.top - rootBox.top) -
    (root.clientHeight - lineBox.height) / 2;
  if (reduced) {
    root.scrollTop = target;
    return;
  }
  const from = root.scrollTop;
  const started = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - started) / LYRIC_SCROLL_MS, 1);
    const eased =
      progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    root.scrollTop = from + (target - from) * eased;
    if (progress < 1) scrollFrame = requestAnimationFrame(step);
    else root.scrollTop = target;
  };
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(step);
}

/** Only one lyric glide runs at a time. */
let scrollFrame = 0;

function LyricWordSpan({ word }: { word: LyricsWord }) {
  const stripped = word.text.replace(/[()]/g, "");
  const emphasis =
    word.end - word.start >= LYRIC_EMPHASIS_MIN_SECONDS &&
    stripped.length > 0 &&
    stripped.length <= LYRIC_EMPHASIS_MAX_LETTERS;
  const characters = emphasis ? [...word.text] : null;
  return (
    <span
      className={
        "lyric-word" +
        (emphasis ? " lyric-word--emphasis" : "") +
        (word.background ? " lyric-word--backing" : "")
      }
      data-word-start={word.start}
      data-word-end={word.end}
    >
      {characters
        ? characters.map((character, index) => (
            <span
              className="lyric-letter"
              key={index}
              data-letter-index={index}
              data-letter-count={characters.length}
            >
              {character}
            </span>
          ))
        : word.text}
    </span>
  );
}

function LyricWords({ words }: { words: LyricsWord[] }) {
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={index}>
          <LyricWordSpan word={word} />
          {word.space ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

function lyricTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const remainingCentiseconds = totalCentiseconds % 6000;
  const wholeSeconds = Math.floor(remainingCentiseconds / 100);
  const centiseconds = remainingCentiseconds % 100;
  return `[${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(
    2,
    "0",
  )}.${String(centiseconds).padStart(2, "0")}]`;
}

function LyricsView({
  client,
  player,
  importedLyrics,
  externalLyricsEnabled,
  lyricsBlurEnabled,
}: {
  client: Navidrome;
  player: Player;
  importedLyrics?: Lyrics | null;
  externalLyricsEnabled: boolean;
  lyricsBlurEnabled: boolean;
}) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [lyricContext, setLyricContext] = useState<{
    x: number;
    y: number;
    line: LyricsLine;
  } | null>(null);
  const lyricsRoot = useRef<HTMLDivElement>(null);
  const id = player.currentSong?.id;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const song = player.currentSong;
    setLyrics(null);
    setLyricContext(null);
    setError(false);
    if (!song) {
      setPending(false);
      return;
    }
    if (importedLyrics) {
      setLyrics(importedLyrics);
      setPending(false);
      return () => controller.abort();
    }
    if (isLocalSong(song) && !externalLyricsEnabled) {
      setPending(false);
      return () => controller.abort();
    }
    setPending(true);
    void (isLocalSong(song)
      ? Promise.resolve<Lyrics | null>(null)
      : client.lyrics(song, controller.signal))
      .then(async (value) => {
        if (!externalLyricsEnabled || value?.synced) return value;
        const external = await client.lrclibLyrics(song, controller.signal);
        return external?.synced || !value?.lines.length ? external : value;
      })
      .then((value) => {
        if (!cancelled) setLyrics(value);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, externalLyricsEnabled, id, importedLyrics, retry]);
  const synced = Boolean(lyrics?.synced);
  // The player object is rebuilt on every render, so it is read through a ref.
  // Depending on it directly would tear the loop down and rebuild it on each
  // render, which starves `requestAnimationFrame` of ever running a frame.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });
  useEffect(() => {
    if (!synced) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let painted = Number.NaN;
    let currentLine: HTMLElement | null = null;
    // Smoothing state for the playback clock, see `sample` below.
    let lastRaw = Number.NaN;
    let anchor = 0;
    let smooth = Number.NaN;
    /**
     * Playback position, interpolated between the decoder's coarse samples.
     *
     * The decoder only reports a new position a handful of times a second, so
     * painting its raw value makes a word's fill advance in visible jumps.
     * Advancing it by wall-clock time between samples — re-anchoring every time
     * the decoder does report — gives a continuous sweep, and never runs
     * backwards while playing, so a stale sample cannot rewind the fill.
     */
    const sample = (now: number) => {
      const player = playerRef.current;
      const raw = player.position();
      const jumpedBackward = Number.isFinite(smooth) && raw < smooth - 0.1;
      if (jumpedBackward) smooth = raw;
      if (!Number.isFinite(lastRaw) || raw !== lastRaw) {
        lastRaw = raw;
        anchor = now;
      }
      if (!player.playing) {
        smooth = raw;
        return raw;
      }
      const lead = Math.min((now - anchor) / 1000, LYRIC_CLOCK_MAX_LEAD);
      const time = Math.max(raw + lead, Number.isFinite(smooth) ? smooth : 0);
      smooth = time;
      return time;
    };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      // The list mounts a render after the lyrics arrive, and again whenever
      // the panel is switched, so the container is resolved every frame rather
      // than captured once.
      const root = lyricsRoot.current;
      if (!root) return;
      const time = sample(performance.now());
      // Only skip while genuinely idle; a playing track always repaints.
      if (time === painted) return;
      painted = time;
      // This runs for every synced song, not just word-by-word ones: a line
      // without words still has to be marked as current, or it would stay
      // dimmed and blurred while it is the line being sung.
      const element = paintLyrics(root, time, reduced);
      if (element === currentLine) return;
      currentLine = element;
      if (element) scrollLyricIntoView(root, element, reduced);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
    };
  }, [synced, lyrics]);
  if (pending)
    return (
      <div className="inspector-empty" role="status">
        <LoaderCircle className="spin" />
        <p>Loading lyrics…</p>
      </div>
    );
  if (error)
    return (
      <div className="inspector-empty">
        <p>Could not load lyrics.</p>
        <button
          className="secondary-button"
          onClick={() => setRetry((old) => old + 1)}
        >
          Try Again
        </button>
      </div>
    );
  if (!lyrics?.lines.length)
    return (
      <div className="inspector-empty">
        <MessageSquareText size={36} strokeWidth={1.4} />
        <h3>{id ? "No lyrics available" : "Nothing playing"}</h3>
        <p>
          {id
            ? isLocalSong(player.currentSong)
              ? "Import lyrics from the clipboard for local files."
              : "This song has no lyrics on your server."
            : "Play a song to see its lyrics."}
        </p>
      </div>
    );
  const lyricContextItems: ContextMenuItem[] = lyricContext
    ? [
        {
          label: "Copy lyric",
          icon: <Copy size={16} />,
          onSelect: () => {
            void navigator.clipboard?.writeText(lyricContext.line.text || "♪");
          },
        },
        {
          label: "Copy lyric with timestamp",
          icon: <Clock3 size={16} />,
          onSelect: () => {
            const text = lyricContext.line.text || "♪";
            void navigator.clipboard?.writeText(
              `${lyricTimestamp(lyricContext.line.start ?? 0)} ${text}`,
            );
          },
        },
      ]
    : [];
  return (
    <>
      <div
        ref={lyricsRoot}
        className={
        "lyrics-lines" +
        (!lyrics.synced ? " unsynced" : "") +
        (!lyricsBlurEnabled ? " no-lyric-blur" : "") +
        (player.playing ? " is-playing" : "")
        }
      >
        {lyrics.lines.map((line, index) =>
          lyrics.synced && line.start !== undefined ? (
            <button
              key={index}
              className={
                "lyric-row" + (line.align === "right" ? " lyric-row--secondary" : "")
              }
              data-line-start={line.start}
              onClick={() => player.seek(line.start!)}
              onContextMenu={(event) => {
                event.preventDefault();
                setLyricContext({ x: event.clientX, y: event.clientY, line });
              }}
            >
              <span className="lyric-line">
                {line.words?.length ? (
                  <LyricWords words={line.words} />
                ) : (
                  line.text || "♪"
                )}
              </span>
              {line.backing?.length ? (
                <span className="lyric-backing">
                  <LyricWords words={line.backing} />
                </span>
              ) : null}
              {line.translation ? (
                <span className="lyric-translation">{line.translation}</span>
              ) : null}
            </button>
          ) : (
            <p key={index}>{line.text}</p>
          ),
        )}
      </div>
      <ContextMenu
        point={lyricContext ? { x: lyricContext.x, y: lyricContext.y } : null}
        items={lyricContextItems}
        label="Lyric actions"
        onClose={() => setLyricContext(null)}
        container={lyricsRoot.current?.closest(".fullscreen-dialog")}
      />
    </>
  );
}

export function Inspector({
  panel,
  client,
  player,
  onClose,
  embedded = false,
  importedLyrics = null,
  onImportLyrics,
  lyricsImporting = false,
  lyricsImportStatus = "",
  externalLyricsEnabled = false,
  lyricsBlurEnabled = true,
}: {
  panel: "queue" | "lyrics";
  client: Navidrome;
  player: Player;
  onClose: () => void;
  embedded?: boolean;
  importedLyrics?: Lyrics | null;
  onImportLyrics?: () => void;
  lyricsImporting?: boolean;
  lyricsImportStatus?: string;
  externalLyricsEnabled?: boolean;
  lyricsBlurEnabled?: boolean;
}) {
  const song = player.currentSong;
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragState = useRef<{ from: number; to: number } | null>(null);
  const upcoming = player.queue.slice(player.currentIndex + 1);
  // Pointer Events give mouse, pen, and touch the same drag path. HTML5
  // drag-and-drop never fires for touch, so phones could not reorder at all.
  const beginDrag =
    (index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragState.current = { from: index, to: index };
      setDraggingIndex(index);
      setDragOverIndex(index);
    };
  const updateDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state) return;
    event.preventDefault();
    const list = event.currentTarget.closest(".queue-content");
    if (!list) return;
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>(".queue-draggable"),
    );
    let target = state.to;
    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom)
        target = index;
    });
    state.to = target;
    setDragOverIndex(target);
  };
  const endDrag = () => {
    const state = dragState.current;
    dragState.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
    if (!state || state.from === state.to) return;
    player.reorderQueue(
      player.currentIndex + 1 + state.from,
      player.currentIndex + 1 + state.to,
    );
  };
  return (
    <aside
      className={"inspector" + (embedded ? " embedded" : "")}
      aria-label={panel === "queue" ? "Playing Next" : "Lyrics"}
    >
      <div className="inspector-heading">
        <div className="inspector-heading-title">
          <h2>{panel === "queue" ? "Playing Next" : "Lyrics"}</h2>
          {panel === "lyrics" && onImportLyrics && (
            <div className="lyrics-import-control">
              <IconButton
                label="Import lyrics from clipboard"
                disabled={lyricsImporting}
                onClick={onImportLyrics}
              >
                <ClipboardPaste size={16} />
              </IconButton>
              {lyricsImportStatus && (
                <span key={lyricsImportStatus} role="status">
                  {lyricsImportStatus}
                </span>
              )}
            </div>
          )}
        </div>
        {!embedded && (
          <IconButton label="Close panel" onClick={onClose}>
            <X size={17} />
          </IconButton>
        )}
      </div>
      {panel === "lyrics" ? (
        <LyricsView
          client={client}
          player={player}
          importedLyrics={importedLyrics}
          externalLyricsEnabled={externalLyricsEnabled}
          lyricsBlurEnabled={lyricsBlurEnabled}
        />
      ) : (
        <div className="queue-content">
          {song && (
            <>
              <h3>Now Playing</h3>
              <div className="queue-song now">
                <Artwork
                  client={client}
                  id={song.coverArt}
                  imageUrl={song.localArtworkUrl}
                  size={100}
                />
                <span>
                  <b>{song.title}</b>
                  <small>{song.artist}</small>
                </span>
                <span className="playing-indicator">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </>
          )}
          <div className="queue-subheading">
            <h3>Queue</h3>
            {player.queue.length > player.currentIndex + 1 && (
              <button onClick={player.clearUpcoming}>Clear</button>
            )}
          </div>
          {upcoming.map((next, index) => (
            <div
              className={
                "queue-song queue-draggable" +
                (draggingIndex === index ? " is-dragging" : "") +
                (dragOverIndex === index ? " is-drag-over" : "")
              }
              key={next.id + "-" + index}
            >
              <button
                type="button"
                className="queue-drag-handle"
                aria-label={`Reorder ${next.title}`}
                onPointerDown={beginDrag(index)}
                onPointerMove={updateDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <GripVertical size={14} />
              </button>
              <button
                className="queue-jump"
                aria-label={"Play " + next.title}
                onClick={() => player.jumpTo(player.currentIndex + 1 + index)}
              >
                <Artwork
                  client={client}
                  id={next.coverArt}
                  imageUrl={next.localArtworkUrl}
                  size={100}
                />
                <span>
                  <b>{next.title}</b>
                  <small>{next.artist}</small>
                </span>
              </button>
              <div className="queue-actions">
                <IconButton
                  label={"Remove " + next.title + " from queue"}
                  onClick={() =>
                    player.removeFromQueue(player.currentIndex + 1 + index)
                  }
                >
                  <X size={14} />
                </IconButton>
              </div>
            </div>
          ))}
          {player.queue.length <= player.currentIndex + 1 && (
            <div className="queue-empty">
              <ListMusic size={30} />
              <p>Your queue is clear.</p>
              <small>Choose Play Next or Play Last from a song’s menu.</small>
            </div>
          )}
          {player.currentIndex > 0 && (
            <>
              <h3 className="history-heading">Previously Played</h3>
              {player.queue
                .slice(0, player.currentIndex)
                .map((previous, index) => (
                  <button
                    className="queue-song queue-history"
                    key={previous.id + index}
                    onClick={() => player.jumpTo(index)}
                  >
                    <Artwork
                      client={client}
                      id={previous.coverArt}
                      imageUrl={previous.localArtworkUrl}
                      size={80}
                    />
                    <span>
                      <b>{previous.title}</b>
                      <small>{previous.artist}</small>
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

/*
 * "Now Playing" backdrop is not CSS: it is a WebGL scene
 * (`LyricsScene`) that composites four rotated copies of the current cover
 * inside a single heavily blurred, strongly graded container. The constants
 * below are the ones that renderer uses, so this markup reproduces it:
 *
 *   mesh   1.25W / 0.80W / 0.50W / 0.25W squares of the cover. Each turns at
 *          its own constant rate; the two smallest also orbit the centre.
 *   blur   five chained PixiJS blur passes (5, 10, 20, 40, 80) which compose
 *          to one ~104px Gaussian.
 *   grade  saturate 2.75, contrast 1.9, brightness 0.7 — applied as ONE affine
 *          map. Chaining the equivalent CSS filter functions would clamp after
 *          every step, where the shader clamps once, which caps every
 *          highlight at 70% instead of letting it reach white.
 *   veil   a 50% black scrim then a 5% white lift.
 *
 * The layout uses percentages only: the orbit wrappers are squares whose side
 * is the viewport width, because every offset in the scene is measured in
 * units of the screen WIDTH, on both axes.
 */
const FULLSCREEN_GRADE_FILTER_ID = "volta-fullscreen-grade";

/**
 * The backdrop is rendered on a 15fps ticker rather than every frame.
 *
 * It is a slow, very heavily blurred wash, so it gains nothing from 60fps —
 * and it costs a great deal: the blurred layer has to be re-rasterised
 * whenever the turning sprites move, and doing that every frame starves every
 * other animation on the page. Measured here, the full-screen view ran at 9fps
 * with the backdrop animating every frame and 28fps with it stopped, so the
 * backdrop alone was eating two thirds of the frame budget.
 */
const FULLSCREEN_RENDER_FPS = 15;
/** How much the backdrop slows down when the user asks for less motion. */
const FULLSCREEN_REDUCED_MOTION_SCALE = 0.2;

/** The new cover fades in (`1 - n`) while the old one fades out (`n`),
 * stepping `n` by 0.04 per tick at the 15fps cap — just under 1.7s. */
const FULLSCREEN_ARTWORK_FADE_MS = 1700;

const FULLSCREEN_GRADE_MATRIX = [
  "3.1628531 -1.6652724 -0.1678308 0 -0.315",
  "-0.4946469 1.9922276 -0.1678308 0 -0.315",
  "-0.4946469 -1.6652724 3.4896692 0 -0.315",
  "0 0 0 1 0",
].join(" ");

function FullscreenArtwork({
  src,
  previous,
}: {
  src?: string;
  previous?: string;
}) {
  return (
    <>
      {previous ? (
        <img
          key={`out:${previous}`}
          className="fullscreen-art fullscreen-art--out"
          src={previous}
          alt=""
          aria-hidden="true"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      {src ? (
        // Keyed so a new cover gets a fresh node: the fade-in is a CSS
        // animation and would not restart on a plain `src` change.
        <img
          key={`in:${src}`}
          className="fullscreen-art fullscreen-art--in"
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
    </>
  );
}

export function FullscreenBackground({
  client,
  artworkReference,
  artworkUrl,
  songId,
}: {
  client: Navidrome;
  artworkReference?: string;
  artworkUrl?: string;
  songId?: string;
}) {
  // Local files hand us an object URL; everything else goes through the same
  // cover endpoint the big record already uses, so the decode is shared.
  const source = artworkUrl || client.cover(artworkReference, 900);
  // The cover that is painted, and the one it is replacing.
  const [painted, setPainted] = useState(source);
  const [outgoing, setOutgoing] = useState<string>();
  const background = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!source || source === painted) return;
    let cancelled = false;
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.src = source;
    // Hold the outgoing cover until the new one is decoded. Starting the
    // crossfade immediately fades towards a frame that paints nothing, so the
    // surface behind the backdrop shows through as a grey flash, and the cover
    // only appears once the fetch has already eaten most of the fade.
    const ready =
      typeof image.decode === "function" ? image.decode() : Promise.resolve();
    void ready
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        setOutgoing(painted);
        setPainted(source);
      });
    return () => {
      cancelled = true;
    };
  }, [source, painted]);
  useEffect(() => {
    if (!outgoing) return;
    // A hair past the fade, so the outgoing cover is never unmounted while the
    // incoming one is still short of fully opaque.
    const timeout = window.setTimeout(
      () => setOutgoing(undefined),
      FULLSCREEN_ARTWORK_FADE_MS + 100,
    );
    return () => window.clearTimeout(timeout);
  }, [outgoing]);
  useEffect(() => {
    const root = background.current;
    if (!root) return;
    const spinners = Array.from(
      root.querySelectorAll<HTMLElement>("[data-spin-period]"),
    );
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const interval = 1000 / FULLSCREEN_RENDER_FPS;
    let frame = 0;
    let painted = Number.NEGATIVE_INFINITY;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // The cap is the point of this loop, not an optimisation of it.
      if (now - painted < interval) return;
      painted = now;
      const seconds =
        (now / 1000) * (reduced ? FULLSCREEN_REDUCED_MOTION_SCALE : 1);
      for (const element of spinners) {
        const period = Number(element.dataset.spinPeriod);
        const direction = Number(element.dataset.spinDirection);
        if (!Number.isFinite(period) || period <= 0) continue;
        const turn = ((seconds / period) % 1) * 360 * direction;
        element.style.setProperty("--fs-angle", `${turn}deg`);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      className="fullscreen-background"
      ref={background}
      data-song={songId ?? ""}
      aria-hidden="true"
    >
      <svg className="fullscreen-grade-defs" aria-hidden="true" focusable="false">
        <filter
          id={FULLSCREEN_GRADE_FILTER_ID}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix type="matrix" values={FULLSCREEN_GRADE_MATRIX} />
        </filter>
      </svg>
      <div className="fullscreen-grade">
        <div className="fullscreen-mesh">
          {/* Fills the corners on viewports where our largest square no
              longer reaches — there its 50% black scrim over a white page
              turns those corners grey. Hidden behind the opaque layers
              everywhere else. */}
          <span className="fullscreen-cover">
            <FullscreenArtwork src={painted} previous={outgoing} />
          </span>
          <span
            className="fullscreen-layer fullscreen-layer--a"
            data-spin-period="69.813"
            data-spin-direction="1"
          >
            <FullscreenArtwork src={painted} previous={outgoing} />
          </span>
          <span
            className="fullscreen-layer fullscreen-layer--b"
            data-spin-period="26.18"
            data-spin-direction="-1"
          >
            <FullscreenArtwork src={painted} previous={outgoing} />
          </span>
          <span
            className="fullscreen-orbit fullscreen-orbit--c"
            data-spin-period="46.542"
            data-spin-direction="-1"
          >
            <span
              className="fullscreen-layer fullscreen-layer--c"
              data-spin-period="34.907"
              data-spin-direction="1"
            >
              <FullscreenArtwork src={painted} previous={outgoing} />
            </span>
          </span>
          <span
            className="fullscreen-orbit fullscreen-orbit--d"
            data-spin-period="69.813"
            data-spin-direction="1"
          >
            <span
              className="fullscreen-layer fullscreen-layer--d"
              data-spin-period="52.36"
              data-spin-direction="-1"
            >
              <FullscreenArtwork src={painted} previous={outgoing} />
            </span>
          </span>
        </div>
      </div>
      <span className="fullscreen-veil" />
      <span className="fullscreen-lift" />
    </div>
  );
}

export function FullPlayer({
  client,
  player,
  onClose,
  onArtist,
  onFavorite,
  favorite,
  externalLyricsEnabled = false,
  lyricsBlurEnabled = true,
  frameMonitor = false,
}: {
  client: Navidrome;
  player: Player;
  onClose: () => void;
  onArtist: (artistId: string, artistName: string) => void;
  onFavorite: (song: Song) => void;
  favorite: boolean;
  externalLyricsEnabled?: boolean;
  lyricsBlurEnabled?: boolean;
  /** Beta-only: show the frame rate and frame-time overlay. */
  frameMonitor?: boolean;
}) {
  const [panel, setPanel] = useState<"queue" | "lyrics">("lyrics");
  const [importedLyrics, setImportedLyrics] = useState<{
    songId: string;
    lyrics: Lyrics;
  } | null>(null);
  const [lyricsImporting, setLyricsImporting] = useState(false);
  const [lyricsImportStatus, setLyricsImportStatus] = useState("");
  const song = player.currentSong;
  const songId = song?.id;
  useEffect(() => {
    setImportedLyrics(null);
    setLyricsImportStatus("");
  }, [songId]);
  useEffect(() => {
    if (!lyricsImportStatus) return;
    const timeout = window.setTimeout(() => setLyricsImportStatus(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [lyricsImportStatus]);

  const importLyrics = async () => {
    if (!songId) return;
    setLyricsImportStatus("");
    if (!navigator.clipboard?.readText) {
      setLyricsImportStatus("Clipboard access is unavailable here.");
      return;
    }
    setLyricsImporting(true);
    try {
      const parsed = parseLyricsText(await navigator.clipboard.readText());
      if (!parsed) {
        setLyricsImportStatus("No readable lyrics found in the clipboard.");
        return;
      }
      setImportedLyrics({ songId, lyrics: parsed });
      setLyricsImportStatus(
        parsed.synced ? "Imported synced lyrics" : "Imported plain lyrics",
      );
    } catch {
      setLyricsImportStatus("Clipboard access was blocked.");
    } finally {
      setLyricsImporting(false);
    }
  };
  const artworkId = usePlayerArtwork(client, song);
  const artworkUrl = isLocalSong(song) ? artworkId : undefined;
  const artworkReference = isLocalSong(song) ? undefined : artworkId;
  if (!song) return null;
  const lyricsOverride =
    importedLyrics?.songId === song.id ? importedLyrics.lyrics : null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Now Playing"
      hideTitle
      className="fullscreen-dialog"
    >
      <FullscreenBackground
        client={client}
        artworkReference={artworkReference}
        artworkUrl={artworkUrl}
        songId={song.id}
      />
      {frameMonitor ? <FrameMonitor /> : null}
      <div className="full-player-layout">
        <section className="full-record">
          <Artwork
            client={client}
            id={artworkReference}
            imageUrl={artworkUrl}
            size={900}
            eager
          />
          <div className="full-record-caption">
            <div>
              <h1>{song.title}</h1>
              {song.artistId ? (
                <button
                  className="full-record-artist"
                  aria-label={`Open artist profile for ${song.artist || "Unknown artist"}`}
                  onClick={() => onArtist(song.artistId!, song.artist || "Unknown artist")}
                >
                  {song.artist || "Unknown artist"}
                </button>
              ) : (
                <p>{song.artist || "Unknown artist"}</p>
              )}
              {player.automixLabel ? (
                <MixingIndicator label={player.automixLabel} />
              ) : null}
            </div>
            <IconButton
              label="Favorite current song"
              active={favorite}
              onClick={() => onFavorite(song)}
            >
              <Star size={23} fill={favorite ? "currentColor" : "none"} />
            </IconButton>
          </div>
          <Seek player={player} times />
          <Transport player={player} large />
          <VolumeControl player={player} fullscreen />
          <div className="full-player-footer">
            <span>
              <AudioLines size={15} />
              {quality(song, player.activeStream)}
            </span>
            <div>
              <IconButton
                label="Show lyrics"
                active={panel === "lyrics"}
                onClick={() => setPanel("lyrics")}
              >
                <MessageSquareText size={19} />
              </IconButton>
              <IconButton
                label="Show queue"
                active={panel === "queue"}
                onClick={() => setPanel("queue")}
              >
                <ListMusic size={20} />
              </IconButton>
            </div>
          </div>
        </section>
        <Inspector
          panel={panel}
          client={client}
          player={player}
          onClose={onClose}
          importedLyrics={lyricsOverride}
          onImportLyrics={importLyrics}
          lyricsImporting={lyricsImporting}
          lyricsImportStatus={lyricsImportStatus}
          externalLyricsEnabled={externalLyricsEnabled}
          lyricsBlurEnabled={lyricsBlurEnabled}
          embedded
        />
      </div>
    </Modal>
  );
}
