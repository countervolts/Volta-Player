import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  AudioLines,
  ClipboardPaste,
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
import { Artwork, IconButton, Modal } from "./components";
import {
  duration,
  isLocalSong,
  isLossless,
  parseLyricsText,
  type Lyrics,
  type Navidrome,
  type Song,
} from "./lib/navidrome";
import { loadArtworkPalette, type ArtworkPalette } from "./lib/palette";
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
}: {
  player: Player;
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
        label={player.volume ? "Mute" : "Unmute"}
        onClick={() => player.setVolume(player.volume ? 0 : 0.8)}
      >
        {player.volume ? (
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
  onInfinitePlay,
  infinitePlayBusy,
  onFavorite,
  favorite,
}: {
  client: Navidrome;
  player: Player;
  panel: "queue" | "lyrics" | null;
  onPanel: (panel: "queue" | "lyrics") => void;
  onExpand: () => void;
  onInfinitePlay: () => void;
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
          disabled={infinitePlayBusy}
          onClick={onInfinitePlay}
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

function LyricsView({
  client,
  player,
  importedLyrics,
  externalLyricsEnabled,
}: {
  client: Navidrome;
  player: Player;
  importedLyrics?: Lyrics | null;
  externalLyricsEnabled: boolean;
}) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);
  const id = player.currentSong?.id;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const song = player.currentSong;
    setLyrics(null);
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
    if (isLocalSong(song)) {
      setPending(false);
      return () => controller.abort();
    }
    setPending(true);
    void client
      .lyrics(song, controller.signal)
      .then((value) =>
        value?.lines.length || !externalLyricsEnabled
          ? value
          : client.lrclibLyrics(song, controller.signal),
      )
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
  let active = -1;
  if (lyrics?.synced)
    lyrics.lines.forEach((line, index) => {
      if (line.start !== undefined && line.start <= player.currentTime)
        active = index;
    });
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [active]);
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
  return (
    <div className={"lyrics-lines" + (!lyrics.synced ? " unsynced" : "")}>
      {lyrics.lines.map((line, index) =>
        lyrics.synced && line.start !== undefined ? (
          <button
            ref={index === active ? activeRef : null}
            key={index}
            className={index === active ? "active-line" : ""}
            onClick={() => player.seek(line.start!)}
          >
            {line.text || "♪"}
          </button>
        ) : (
          <p key={index}>{line.text}</p>
        ),
      )}
    </div>
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
}) {
  const song = player.currentSong;
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const upcoming = player.queue.slice(player.currentIndex + 1);
  const finishDrag = () => {
    setDraggingIndex(null);
    setDragOverIndex(null);
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
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
                setDraggingIndex(index);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverIndex(index);
              }}
              onDragLeave={() =>
                setDragOverIndex((current) => (current === index ? null : current))
              }
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData("text/plain"));
                if (Number.isInteger(from))
                  player.reorderQueue(
                    player.currentIndex + 1 + from,
                    player.currentIndex + 1 + index,
                  );
                finishDrag();
              }}
              onDragEnd={finishDrag}
            >
              <span className="queue-drag-handle" aria-hidden="true">
                <GripVertical size={14} />
              </span>
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
  const [palette, setPalette] = useState<ArtworkPalette>();
  const paletteSource = artworkUrl || client.cover(artworkReference, 600);
  useEffect(() => {
    if (!paletteSource) {
      setPalette(undefined);
      return;
    }
    let active = true;
    void loadArtworkPalette(paletteSource).then((next) => {
      if (active) setPalette(next);
    });
    return () => {
      active = false;
    };
  }, [paletteSource]);
  // Apple Music's full-screen background is a mesh gradient built from the
  // artwork's dominant colors, not a blurred copy of the cover. Expose the
  // sampled colors as custom properties so the mesh crossfades between tracks.
  const colors = palette?.colors ?? [];
  const style = {
    "--fullscreen-deep": palette?.deep ?? "#0b0b12",
    ...Object.fromEntries(
      colors.slice(0, 6).map((color, index) => [`--fullscreen-c${index + 1}`, color]),
    ),
  } as CSSProperties;
  return (
    <div
      className="fullscreen-background"
      style={style}
      data-song={songId ?? ""}
      aria-hidden="true"
    >
      <div className="fullscreen-mesh">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className={`fullscreen-blob fullscreen-blob--${index + 1}`}
          />
        ))}
      </div>
      <span className="fullscreen-vignette" />
      <span className="fullscreen-grain" />
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
}: {
  client: Navidrome;
  player: Player;
  onClose: () => void;
  onArtist: (artistId: string, artistName: string) => void;
  onFavorite: (song: Song) => void;
  favorite: boolean;
  externalLyricsEnabled?: boolean;
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
          embedded
        />
      </div>
    </Modal>
  );
}
