import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";
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
import type { AlbumRecommendationInput } from "../lib/recommendations";
import type { RecommendationTuning } from "../lib/recommendation-tuning";
import {
  PLAYLIST_DESCRIPTION_MAX_LENGTH,
  type ContextTarget,
  type PlaylistDraft,
  type Route,
} from "./app-model";

type Setter<T> = Dispatch<SetStateAction<T>>;
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
  /** Beta-only: show the frame rate overlay in the full-screen player. */
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
  notice: string;
  setNotice: Setter<string>;
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
        onClose={() => setDetailsSong(null)}
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
              <p>{detailsSong.artist || "Unknown artist"}</p>
              {detailsSong.album && <small>{detailsSong.album}</small>}
              <dl>
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(detailsSong.duration)}</dd>
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
              </dl>
              <SongCreditsPanel song={detailsSong} />
              <div className="media-details-actions">
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
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(detailsAlbum)}
        onClose={() => setDetailsAlbum(null)}
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
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <IconButton label="Dismiss message" onClick={() => setNotice("")}>
            <X size={16} />
          </IconButton>
        </div>
      )}
    </>
  );
}
