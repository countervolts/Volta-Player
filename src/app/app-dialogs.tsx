import { useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import { Disc3, ListMusic, ListPlus, Search, UserRound, X } from "lucide-react";
import {
  Artwork,
  ContextMenu,
  IconButton,
  Modal,
  type ContextMenuItem,
} from "../components";
import { FullPlayer } from "../player-ui";
import {
  albumName,
  duration,
  isLossless,
  type AlbumRecord,
  type Navidrome,
  type Playlist,
  type Song,
} from "../lib/navidrome";
import type { Player } from "../lib/use-player";
import type { EngagementEvent, EngagementProfile } from "../lib/interactions";
import type { ListeningEvent, ListeningProfile } from "../lib/listening-history";
import type { RankerModel } from "../lib/learned-ranker";
import {
  formatShortcut,
  SHORTCUT_DEFINITIONS,
  type ShortcutBindings,
  type ShortcutDefinition,
  type ShortcutId,
} from "../shortcuts";
import { ListeningHistoryView } from "./app-views";
import { RecommendationEngineDialog } from "./recommendation-engine-dialog";
import { SongCreditsPanel } from "./song-credits";
import { NotificationToast, type NotificationNotice } from "./notifications";
import type { AlbumRecommendationInput } from "../lib/recommendations";
import type { RecommendationTuning } from "../lib/recommendation-tuning";
import type { LocalMetadataPatch } from "../lib/local-music";
import {
  PLAYLIST_DESCRIPTION_MAX_LENGTH,
  type ContextTarget,
  type PlaylistDraft,
  type Route,
} from "./app-model";

type Setter<T> = Dispatch<SetStateAction<T>>;
type LocalMetadataEditorProps = {
  busy?: boolean;
  onCancel: () => void;
  onSave: (metadata: LocalMetadataPatch) => void | Promise<void>;
};

function MetadataTextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
}) {
  return (
    <label className="local-metadata-field">
      {label}
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? 1 : undefined}
      />
    </label>
  );
}

function SongMetadataEditor({
  song,
  onCancel,
  onSave,
}: LocalMetadataEditorProps & { song: Song }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: song.title,
    artist: song.artist || "",
    albumArtist: song.albumArtist || "",
    composer: song.composer || "",
    album: song.album || "",
    track: song.track ? String(song.track) : "",
    discNumber: song.discNumber ? String(song.discNumber) : "",
    year: song.year ? String(song.year) : "",
    genre: song.genre || "",
  });
  const text = (key: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const number = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;

  return (
    <form
      className="local-metadata-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave({
            title: draft.title,
            artist: draft.artist,
            albumArtist: draft.albumArtist,
            composer: draft.composer,
            album: draft.album,
            track: number(draft.track),
            discNumber: number(draft.discNumber),
            year: number(draft.year),
            genre: draft.genre,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>Saved in Volta on this device. Your audio file stays untouched.</p>
      <div className="local-metadata-fields">
        <MetadataTextField label="Title" value={draft.title} onChange={text("title")} />
        <MetadataTextField label="Artist" value={draft.artist} onChange={text("artist")} />
        <MetadataTextField label="Album artist" value={draft.albumArtist} onChange={text("albumArtist")} />
        <MetadataTextField label="Album" value={draft.album} onChange={text("album")} />
        <MetadataTextField label="Composer" value={draft.composer} onChange={text("composer")} />
        <MetadataTextField label="Genre" value={draft.genre} onChange={text("genre")} />
        <MetadataTextField label="Track number" value={draft.track} onChange={text("track")} type="number" />
        <MetadataTextField label="Disc number" value={draft.discNumber} onChange={text("discNumber")} type="number" />
        <MetadataTextField label="Year" value={draft.year} onChange={text("year")} type="number" />
      </div>
      <div className="local-metadata-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save metadata"}
        </button>
      </div>
    </form>
  );
}

function AlbumMetadataEditor({
  album,
  onCancel,
  onSave,
}: LocalMetadataEditorProps & { album: AlbumRecord }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    album: albumName(album),
    artist: album.artist || "",
    year: album.year ? String(album.year) : "",
    genre: album.genre || "",
  });
  const text = (key: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="local-metadata-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave({
            album: draft.album,
            albumArtist: draft.artist,
            year: draft.year.trim() && Number.isFinite(Number(draft.year))
              ? Number(draft.year)
              : undefined,
            genre: draft.genre,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>Saved in Volta on this device. Your audio files stay untouched.</p>
      <div className="local-metadata-fields">
        <MetadataTextField label="Album" value={draft.album} onChange={text("album")} />
        <MetadataTextField label="Album artist" value={draft.artist} onChange={text("artist")} />
        <MetadataTextField label="Year" value={draft.year} onChange={text("year")} type="number" />
        <MetadataTextField label="Genre" value={draft.genre} onChange={text("genre")} />
      </div>
      <div className="local-metadata-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save metadata"}
        </button>
      </div>
    </form>
  );
}

const codecNames: Record<string, string> = {
  aac: "AAC",
  "ac-3": "Dolby Digital (AC-3)",
  alac: "Apple Lossless (ALAC)",
  "e-ac-3": "Dolby Digital Plus (E-AC-3)",
  flac: "FLAC",
  mp3: "MP3",
  opus: "Opus",
  pcm: "PCM",
  vorbis: "Vorbis",
};
const audioCodecName = (song: Song) => {
  const codec = song.codec?.trim().toLowerCase();
  if (codec) {
    if (codec.startsWith("mp4a")) return "AAC";
    return codecNames[codec] || song.codec!.trim().toUpperCase();
  }
  const suffix = song.suffix?.replace(/^\./, "").toLowerCase();
  const inferred: Record<string, string> = {
    aac: "AAC",
    aif: "PCM",
    aiff: "PCM",
    alac: "Apple Lossless (ALAC)",
    flac: "FLAC",
    mp3: "MP3",
    opus: "Opus",
    wav: "PCM",
    wave: "PCM",
    wma: "Windows Media Audio",
  };
  if (suffix && inferred[suffix]) return inferred[suffix];
  return suffix ? `Unknown (${suffix.toUpperCase()})` : "Unknown";
};
type Props = {
  addSongsToPlaylist: (playlist: Playlist, songs: Song[]) => void | Promise<void>;
  changeListeningHistoryPersistence: (value: boolean) => void;
  client: Navidrome;
  closeContextMenu: () => void;
  closeFullPlayer: () => void;
  contextItems: ContextMenuItem[];
  contextTarget: ContextTarget | null;
  deletePlaylist: () => void | Promise<void>;
  detailsAlbum: AlbumRecord | null;
  detailsSong: Song | null;
  engagementEvents: EngagementEvent[];
  engagementProfile: EngagementProfile;
  engineOpen: boolean;
  externalLyricsEnabled: boolean;
  lyricsBlurEnabled: boolean;
  /** Beta-only: show the performance overlay in the full-screen player. */
  frameMonitor: boolean;
  favorite: (song: Song) => void | Promise<void>;
  filteredShortcuts: ShortcutDefinition[];
  fullPlayer: boolean;
  isFavorite: (song: Song) => boolean;
  listeningEvents: ListeningEvent[];
  listeningHistoryEnabled: boolean;
  listeningHistoryOpen: boolean;
  listeningHistoryPersistent: boolean;
  listeningProfile: ListeningProfile;
  modifierLabel: string;
  navigate: (next: Route) => void;
  notice: NotificationNotice | null;
  setNotice: Setter<NotificationNotice | null>;
  player: Player;
  volumeScrollStep: number;
  volumeShiftScrollStep: number;
  setFullPlayer: Setter<boolean>;
  playlistDraft: PlaylistDraft | null;
  playlistMutationBusy: boolean;
  playlistPickerSongs: Song[] | null;
  playlistToDelete: Playlist | null;
  rankerModel: RankerModel;
  recommendationPreviewContext: Omit<
    AlbumRecommendationInput,
    "tuning" | "limit"
  >;
  recommendationTuning: RecommendationTuning;
  recordShortcut: (id: ShortcutId, event: ReactKeyboardEvent) => void;
  recordingShortcut: ShortcutId | null;
  resetLearning: () => void;
  resetRecommendationTuning: () => void;
  resetShortcuts: () => void;
  savePlaylist: () => void | Promise<void>;
  setDetailsAlbum: Setter<AlbumRecord | null>;
  setDetailsSong: Setter<Song | null>;
  saveLocalSongMetadata: (
    song: Song,
    metadata: LocalMetadataPatch,
  ) => Promise<Song | null>;
  saveLocalAlbumMetadata: (
    album: AlbumRecord,
    metadata: LocalMetadataPatch,
  ) => Promise<AlbumRecord | null>;
  sourceMode: "navidrome" | "local";
  setEngineOpen: Setter<boolean>;
  setListeningHistoryOpen: Setter<boolean>;
  setPlaylistDraft: Setter<PlaylistDraft | null>;
  setPlaylistPickerSongs: Setter<Song[] | null>;
  setPlaylistToDelete: Setter<Playlist | null>;
  setRecordingShortcut: Setter<ShortcutId | null>;
  setShortcutQuery: Setter<string>;
  setShortcutsOpen: Setter<boolean>;
  shortcuts: ShortcutBindings;
  shortcutQuery: string;
  shortcutsOpen: boolean;
  sidebarPlaylists: Playlist[];
  updateRecommendationTuning: (patch: Partial<RecommendationTuning>) => void;
};

export function AppDialogs({
  addSongsToPlaylist,
  changeListeningHistoryPersistence,
  client,
  closeContextMenu,
  closeFullPlayer,
  contextItems,
  contextTarget,
  deletePlaylist,
  detailsAlbum,
  detailsSong,
  engagementEvents,
  engagementProfile,
  engineOpen,
  externalLyricsEnabled,
  lyricsBlurEnabled,
  frameMonitor,
  favorite,
  filteredShortcuts,
  fullPlayer,
  isFavorite,
  listeningEvents,
  listeningHistoryEnabled,
  listeningHistoryOpen,
  listeningHistoryPersistent,
  listeningProfile,
  modifierLabel,
  navigate,
  notice,
  setNotice,
  player,
  volumeScrollStep,
  volumeShiftScrollStep,
  setFullPlayer,
  playlistDraft,
  playlistMutationBusy,
  playlistPickerSongs,
  playlistToDelete,
  rankerModel,
  recommendationPreviewContext,
  recommendationTuning,
  recordShortcut,
  recordingShortcut,
  resetLearning,
  resetRecommendationTuning,
  resetShortcuts,
  savePlaylist,
  saveLocalSongMetadata,
  saveLocalAlbumMetadata,
  sourceMode,
  setDetailsAlbum,
  setDetailsSong,
  setEngineOpen,
  setListeningHistoryOpen,
  setPlaylistDraft,
  setPlaylistPickerSongs,
  setPlaylistToDelete,
  setRecordingShortcut,
  setShortcutQuery,
  setShortcutsOpen,
  shortcuts,
  shortcutQuery,
  shortcutsOpen,
  sidebarPlaylists,
  updateRecommendationTuning,
}: Props) {
  const [editingSongMetadata, setEditingSongMetadata] = useState(false);
  const [editingAlbumMetadata, setEditingAlbumMetadata] = useState(false);
  return (
    <>
      {fullPlayer && (
        <FullPlayer
          client={client}
          player={player}
          volumeScrollStep={volumeScrollStep}
          volumeShiftScrollStep={volumeShiftScrollStep}
          onClose={closeFullPlayer}
          onArtist={(artistId, artistName) => {
            setFullPlayer(false);
            navigate({ page: "artist", id: artistId, title: artistName });
          }}
          onFavorite={favorite}
          favorite={player.currentSong ? isFavorite(player.currentSong) : false}
          externalLyricsEnabled={externalLyricsEnabled}
          lyricsBlurEnabled={lyricsBlurEnabled}
          frameMonitor={frameMonitor}
        />
      )}
      <ContextMenu
        point={
          contextTarget
            ? { x: contextTarget.x, y: contextTarget.y }
            : null
        }
        items={contextItems}
        label={contextTarget?.type === "album" ? "Album actions" : "Song actions"}
        onClose={closeContextMenu}
      />
      <Modal
        open={Boolean(playlistDraft)}
        onClose={() => !playlistMutationBusy && setPlaylistDraft(null)}
        title={playlistDraft?.playlist ? "Edit Playlist" : "New Playlist"}
      >
        {playlistDraft && (
          <form
            className="playlist-form"
            onSubmit={(event) => {
              event.preventDefault();
              void savePlaylist();
            }}
          >
            <label>
              Playlist name
              <input
                aria-label="Playlist name"
                autoFocus
                value={playlistDraft.name}
                onChange={(event) =>
                  setPlaylistDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </label>
            {playlistDraft.playlist && (
              <>
                <label>
                  Description
                  <textarea
                    aria-label="Playlist description"
                    rows={3}
                    maxLength={PLAYLIST_DESCRIPTION_MAX_LENGTH}
                    value={playlistDraft.comment || ""}
                    onChange={(event) =>
                      setPlaylistDraft((current) =>
                        current
                          ? { ...current, comment: event.target.value }
                          : current,
                      )
                    }
                  />
                </label>
              </>
            )}
            {playlistDraft.song && (
              <p>Adds “{playlistDraft.song.title}” to this playlist.</p>
            )}
            <div className="playlist-form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={playlistMutationBusy}
                onClick={() => setPlaylistDraft(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={playlistMutationBusy}>
                {playlistMutationBusy
                  ? "Saving…"
                  : playlistDraft.playlist
                    ? "Save Changes"
                    : "Create Playlist"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(playlistPickerSongs)}
        onClose={() => !playlistMutationBusy && setPlaylistPickerSongs(null)}
        title="Add to Playlist"
      >
        {playlistPickerSongs && (
          <div className="playlist-picker">
            <p>
              {playlistPickerSongs.length === 1
                ? `Add “${playlistPickerSongs[0].title}” to:`
                : `Add ${playlistPickerSongs.length} songs to:`}
            </p>
            {sidebarPlaylists.length ? (
              <div className="playlist-picker-list">
                {sidebarPlaylists.map((playlist) => (
                  <button
                    className="secondary-button"
                    key={playlist.id}
                    disabled={playlistMutationBusy || playlist.readonly}
                    onClick={() =>
                      void addSongsToPlaylist(playlist, playlistPickerSongs)
                    }
                  >
                    <ListMusic size={16} />
                    {playlist.name}
                  </button>
                ))}
              </div>
            ) : (
              <p>You do not have any editable playlists yet.</p>
            )}
            <button
              className="primary-button"
              disabled={playlistMutationBusy}
              onClick={() => {
                setPlaylistDraft({
                  name: "",
                  song: playlistPickerSongs[0],
                });
                setPlaylistPickerSongs(null);
              }}
            >
              <ListPlus size={16} />
              New Playlist
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(playlistToDelete)}
        onClose={() => !playlistMutationBusy && setPlaylistToDelete(null)}
        title="Delete Playlist"
      >
        {playlistToDelete && (
          <div className="playlist-form">
            <p>
              Delete “{playlistToDelete.name}”? This only removes the playlist,
              not the music in it.
            </p>
            <div className="playlist-form-actions">
              <button
                className="secondary-button"
                disabled={playlistMutationBusy}
                onClick={() => setPlaylistToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={playlistMutationBusy}
                onClick={() => void deletePlaylist()}
              >
                {playlistMutationBusy ? "Deleting…" : "Delete Playlist"}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(detailsSong)}
        onClose={() => {
          setEditingSongMetadata(false);
          setDetailsSong(null);
        }}
        title="Song details"
        className="media-details-dialog"
      >
        {detailsSong && (
          <div className="media-details">
            <Artwork
              client={client}
              id={detailsSong.coverArt}
              imageUrl={detailsSong.localArtworkUrl}
              size={420}
              eager
            />
            <div className="media-details-copy">
              <h3>{detailsSong.title}</h3>
              {editingSongMetadata && sourceMode === "local" ? (
                <SongMetadataEditor
                  key={detailsSong.id}
                  song={detailsSong}
                  onCancel={() => setEditingSongMetadata(false)}
                  onSave={async (metadata) => {
                    const saved = await saveLocalSongMetadata(detailsSong, metadata);
                    if (saved) {
                      setDetailsSong(saved);
                      setEditingSongMetadata(false);
                    }
                  }}
                />
              ) : (
                <>
                  <p>{detailsSong.artist || "Unknown artist"}</p>
                  {detailsSong.album && <small>{detailsSong.album}</small>}
                  <dl>
                    <div>
                      <dt>Duration</dt>
                      <dd>{duration(detailsSong.duration)}</dd>
                    </div>
                    <div>
                      <dt>Audio codec</dt>
                      <dd>{audioCodecName(detailsSong)}</dd>
                    </div>
                    <div>
                      <dt>Format</dt>
                      <dd>
                        {isLossless(detailsSong)
                          ? "Lossless"
                          : detailsSong.suffix?.toUpperCase() || "Unknown"}
                      </dd>
                    </div>
                    {detailsSong.year && (
                      <div>
                        <dt>Year</dt>
                        <dd>{detailsSong.year}</dd>
                      </div>
                    )}
                    {detailsSong.genre && (
                      <div>
                        <dt>Genre</dt>
                        <dd>{detailsSong.genre}</dd>
                      </div>
                    )}
                    {detailsSong.track && (
                      <div>
                        <dt>Track</dt>
                        <dd>{detailsSong.track}</dd>
                      </div>
                    )}
                  </dl>
                  <SongCreditsPanel song={detailsSong} />
                  <div className="media-details-actions">
                    {sourceMode === "local" && (
                      <button
                        className="secondary-button"
                        onClick={() => setEditingSongMetadata(true)}
                      >
                        Edit metadata
                      </button>
                    )}
                    {detailsSong.albumId && (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setDetailsSong(null);
                          navigate({
                            page: "album",
                            id: detailsSong.albumId,
                            title: detailsSong.album,
                          });
                        }}
                      >
                        <Disc3 size={15} />
                        Go to Album
                      </button>
                    )}
                    {detailsSong.artistId && (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setDetailsSong(null);
                          navigate({
                            page: "artist",
                            id: detailsSong.artistId,
                            title: detailsSong.artist,
                          });
                        }}
                      >
                        <UserRound size={15} />
                        Go to Artist
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(detailsAlbum)}
        onClose={() => {
          setEditingAlbumMetadata(false);
          setDetailsAlbum(null);
        }}
        title="Album details"
        className="media-details-dialog"
      >
        {detailsAlbum && (
          <div className="media-details">
            <Artwork
              client={client}
              id={detailsAlbum.coverArt}
              imageUrl={detailsAlbum.localArtworkUrl}
              size={420}
              eager
            />
            <div className="media-details-copy">
              <h3>{albumName(detailsAlbum)}</h3>
              {editingAlbumMetadata && sourceMode === "local" ? (
                <AlbumMetadataEditor
                  key={detailsAlbum.id}
                  album={detailsAlbum}
                  onCancel={() => setEditingAlbumMetadata(false)}
                  onSave={async (metadata) => {
                    const saved = await saveLocalAlbumMetadata(detailsAlbum, metadata);
                    if (saved) {
                      setDetailsAlbum(saved);
                      setEditingAlbumMetadata(false);
                    }
                  }}
                />
              ) : (
                <>
                  <p>{detailsAlbum.artist || "Unknown artist"}</p>
                  <dl>
                    <div>
                      <dt>Songs</dt>
                      <dd>{detailsAlbum.songCount ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{duration(detailsAlbum.duration)}</dd>
                    </div>
                    {detailsAlbum.year && (
                      <div>
                        <dt>Year</dt>
                        <dd>{detailsAlbum.year}</dd>
                      </div>
                    )}
                    {detailsAlbum.genre && (
                      <div>
                        <dt>Genre</dt>
                        <dd>{detailsAlbum.genre}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="media-details-actions">
                    {sourceMode === "local" && (
                      <button
                        className="secondary-button"
                        onClick={() => setEditingAlbumMetadata(true)}
                      >
                        Edit metadata
                      </button>
                    )}
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setDetailsAlbum(null);
                        navigate({
                          page: "album",
                          id: detailsAlbum.id,
                          title: albumName(detailsAlbum),
                        });
                      }}
                    >
                      <Disc3 size={15} />
                      Open Album
                    </button>
                    {detailsAlbum.artistId && (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setDetailsAlbum(null);
                          navigate({
                            page: "artist",
                            id: detailsAlbum.artistId,
                            title: detailsAlbum.artist,
                          });
                        }}
                      >
                        <UserRound size={15} />
                        Go to Artist
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={listeningHistoryOpen}
        onClose={() => setListeningHistoryOpen(false)}
        title="Listening history"
        className="listening-history-dialog"
      >
        <ListeningHistoryView
          events={listeningEvents}
          profile={listeningProfile}
          engagementEvents={engagementEvents}
          engagementProfile={engagementProfile}
          rankerModel={rankerModel}
          enabled={listeningHistoryEnabled}
          persistent={listeningHistoryPersistent}
          onPersistenceChange={changeListeningHistoryPersistence}
          onResetLearning={resetLearning}
        />
      </Modal>
      <RecommendationEngineDialog
        open={engineOpen}
        onClose={() => setEngineOpen(false)}
        previewContext={recommendationPreviewContext}
        tuning={recommendationTuning}
        onChange={updateRecommendationTuning}
        onReset={resetRecommendationTuning}
        rankerSamples={rankerModel.samples}
      />
      <Modal
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
          setRecordingShortcut(null);
        }}
        title="Keyboard shortcuts"
        className="keyboard-shortcuts-dialog"
      >
        <div className="shortcut-manager">
          <div className="shortcut-manager-toolbar">
            <label className="shortcut-search">
              <Search size={15} />
              <input
                autoFocus
                aria-label="Search keyboard shortcuts"
                placeholder="Search shortcuts"
                value={shortcutQuery}
                onChange={(event) => setShortcutQuery(event.target.value)}
              />
              {shortcutQuery && (
                <button
                  type="button"
                  className="shortcut-search-clear"
                  aria-label="Clear shortcut search"
                  onClick={() => setShortcutQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <button className="secondary-button" onClick={resetShortcuts}>
              Reset defaults
            </button>
          </div>
          <p className="shortcut-manager-summary">
            {filteredShortcuts.length} of {SHORTCUT_DEFINITIONS.length} shortcuts
            {recordingShortcut ? " · Press a key combination to assign it" : ""}
          </p>
          <div className="shortcut-list" role="list" aria-label="Keyboard shortcuts">
            {filteredShortcuts.length ? (
              filteredShortcuts.map((definition, index) => {
                const showCategory =
                  index === 0 ||
                  definition.category !== filteredShortcuts[index - 1].category;
                const isRecording = recordingShortcut === definition.id;
                const bindingLabel = formatShortcut(shortcuts[definition.id]);
                return (
                  <div className="shortcut-group" key={definition.id}>
                    {showCategory && <h3>{definition.category}</h3>}
                    <div className="shortcut-row" role="listitem">
                      <span className="shortcut-copy">
                        <b>{definition.label}</b>
                        <small>{definition.description}</small>
                      </span>
                      <button
                        type="button"
                        className={
                          "shortcut-binding" + (isRecording ? " recording" : "")
                        }
                        aria-label={`${definition.label}: ${
                          isRecording ? "Press a key combination" : bindingLabel
                        }`}
                        onClick={() => setRecordingShortcut(definition.id)}
                        onKeyDown={(event) =>
                          isRecording && recordShortcut(definition.id, event)
                        }
                      >
                        {isRecording ? "Press keys…" : bindingLabel}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="shortcut-empty">
                <Search size={22} />
                <p>No shortcuts match “{shortcutQuery}”.</p>
              </div>
            )}
          </div>
          <p className="setting-description">
            Select a binding, then press the new key combination. On this device,
            the modifier key is {modifierLabel}. Shortcuts pause while you type
            in a field.
          </p>
        </div>
      </Modal>
      <NotificationToast notice={notice} setNotice={setNotice} />
    </>
  );
}
