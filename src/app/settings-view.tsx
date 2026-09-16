import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Activity,
  AudioLines,
  Blend,
  Brain,
  CircleUserRound,
  ClipboardCopy,
  Eye,
  FileText,
  FlaskConical,
  Gauge,
  Infinity as InfinityIcon,
  Keyboard,
  LifeBuoy,
  ListMusic,
  Lock,
  Palette,
  PanelLeft,
  RefreshCw,
  Scaling,
  Share2,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import type { Credentials } from "../lib/navidrome";
import {
  accountKey,
  safeWrite,
  type InfinitePlayMode,
  type SavedAccount,
  type ShareProvider,
  type TransitionMode,
} from "./app-storage";
import type { EngagementEvent } from "../lib/interactions";
import { clearListeningHistory, type ListeningEvent } from "../lib/listening-history";
import type { Player } from "../lib/use-player";
import type { ShortcutId } from "../shortcuts";
import type { SettingsFocus } from "./app-model";

type Setter<T> = Dispatch<SetStateAction<T>>;

const diagnosticSummary = () => {
  const agent = navigator.userAgent;
  const browser = /Firefox\//.test(agent)
    ? "Firefox"
    : /Edg\//.test(agent)
      ? "Edge"
      : /Chrome\//.test(agent) || /CriOS\//.test(agent)
        ? "Chromium"
        : /Safari\//.test(agent)
          ? "WebKit"
          : "Other";
  return [
    "Volta local diagnostic summary",
    "channel=beta",
    `browser=${browser}`,
    `online=${navigator.onLine ? "yes" : "no"}`,
    `viewport=${window.innerWidth}x${window.innerHeight}`,
  ].join("\n");
};
type Props = {
  account: { server: string; username: string };
  accounts: SavedAccount[];
  animatedArtwork: boolean;
  animateArtworkEverywhere: boolean;
  /** Diagnostics are only offered on the beta channel. */
  betaChannel: boolean;
  beginInterfaceScalePreview: () => void;
  connect: (credentials: Credentials, rememberMe?: boolean) => void | Promise<void>;
  connecting: boolean;
  crossfadeSeconds: number;
  volumeScrollStep: number;
  volumeShiftScrollStep: number;
  disconnect: () => void;
  engagementEvents: EngagementEvent[];
  experimentalArtworkLoading: boolean;
  externalLyricsEnabled: boolean;
  lyricsBlurEnabled: boolean;
  floatingSidebar: boolean;
  forgetAccount: (account: SavedAccount) => void;
  frameMonitorEnabled: boolean;
  infinitePlayBusy: boolean;
  infinitePlayCount: number;
  infinitePlayEnabled: boolean;
  infinitePlayMode: InfinitePlayMode;
  interfaceScale: number;
  listeningEvents: ListeningEvent[];
  listeningHistoryEnabled: boolean;
  normalization: "off" | "track" | "album";
  notify: (message: string) => void;
  player: Player;
  rankerModel: { samples: number };
  /** Opens the standalone recommendation engine screen. */
  openEngine: () => void;
  refreshCollectionOnVisit: boolean;
  resetLearning: () => void;
  setAnimatedArtwork: Setter<boolean>;
  setAnimateArtworkEverywhere: Setter<boolean>;
  setCrossfadeSeconds: Setter<number>;
  setVolumeScrollStep: Setter<number>;
  setVolumeShiftScrollStep: Setter<number>;
  setExperimentalArtworkLoading: Setter<boolean>;
  setExternalLyricsEnabled: Setter<boolean>;
  setLyricsBlurEnabled: Setter<boolean>;
  setFloatingSidebar: Setter<boolean>;
  setFrameMonitorEnabled: Setter<boolean>;
  setInfinitePlayCount: Setter<number>;
  setInfinitePlayMode: Setter<InfinitePlayMode>;
  setListeningEvents: Setter<ListeningEvent[]>;
  setListeningHistoryEnabled: Setter<boolean>;
  setListeningHistoryOpen: Setter<boolean>;
  setNormalization: Setter<"off" | "track" | "album">;
  setRefreshCollectionOnVisit: Setter<boolean>;
  setShareProvider: Setter<ShareProvider>;
  setShortcutQuery: Setter<string>;
  setRecordingShortcut: Setter<ShortcutId | null>;
  setShortcutsOpen: Setter<boolean>;
  setTheme: Setter<string>;
  settingsFocus?: SettingsFocus;
  sourceMode: "navidrome" | "local";
  shareProvider: ShareProvider;
  theme: string;
  transitionMode: TransitionMode;
  setTransitionMode: Setter<TransitionMode>;
  toggleInfinitePlay: () => void;
  trackingKey: string;
  warnBeforeLeave: boolean;
  setWarnBeforeLeave: Setter<boolean>;
};

/**
 * The leading glyph: a small rounded tile tinted with a system color.
 * The tile is decorative, so it is hidden from assistive technology and the
 * row's own label carries the meaning.
 */
type SettingTone =
  | "blue"
  | "green"
  | "indigo"
  | "orange"
  | "pink"
  | "purple"
  | "teal"
  | "gray";

function SettingIcon({
  tone,
  children,
}: {
  tone: SettingTone;
  children: ReactNode;
}) {
  return (
    <span className="setting-icon" data-tone={tone} aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * Settings are split into panes so only one group of controls is on screen at
 * a time. The tab bar mirrors the macOS Settings toolbar: a stable row of
 * labelled destinations that always shows which pane is active.
 */
type SettingsTab =
  | "appearance"
  | "playback"
  | "privacy"
  | "sharing"
  | "keyboard"
  | "help"
  | "account"
  | "diagnostics";

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={15} /> },
  { id: "playback", label: "Playback", icon: <AudioLines size={15} /> },
  { id: "privacy", label: "Privacy", icon: <ShieldCheck size={15} /> },
  { id: "sharing", label: "Sharing", icon: <Share2 size={15} /> },
  { id: "keyboard", label: "Keyboard", icon: <Keyboard size={15} /> },
  { id: "help", label: "Help", icon: <LifeBuoy size={15} /> },
  { id: "account", label: "Account", icon: <CircleUserRound size={15} /> },
];

export function SettingsView({
  account,
  accounts,
  animatedArtwork,
  animateArtworkEverywhere,
  betaChannel,
  beginInterfaceScalePreview,
  connect,
  connecting,
  crossfadeSeconds,
  volumeScrollStep,
  volumeShiftScrollStep,
  disconnect,
  engagementEvents,
  experimentalArtworkLoading,
  externalLyricsEnabled,
  lyricsBlurEnabled,
  floatingSidebar,
  forgetAccount,
  frameMonitorEnabled,
  infinitePlayBusy,
  infinitePlayCount,
  infinitePlayEnabled,
  infinitePlayMode,
  interfaceScale,
  listeningEvents,
  listeningHistoryEnabled,
  normalization,
  notify,
  openEngine,
  player,
  rankerModel,
  refreshCollectionOnVisit,
  resetLearning,
  setAnimatedArtwork,
  setAnimateArtworkEverywhere,
  setCrossfadeSeconds,
  setVolumeScrollStep,
  setVolumeShiftScrollStep,
  setExperimentalArtworkLoading,
  setExternalLyricsEnabled,
  setLyricsBlurEnabled,
  setFloatingSidebar,
  setFrameMonitorEnabled,
  setInfinitePlayCount,
  setInfinitePlayMode,
  setListeningEvents,
  setListeningHistoryEnabled,
  setListeningHistoryOpen,
  setNormalization,
  setRefreshCollectionOnVisit,
  setShareProvider,
  setShortcutQuery,
  setRecordingShortcut,
  setShortcutsOpen,
  setTheme,
  settingsFocus,
  sourceMode,
  shareProvider,
  theme,
  transitionMode,
  setTransitionMode,
  toggleInfinitePlay,
  trackingKey,
  warnBeforeLeave,
  setWarnBeforeLeave,
}: Props) {
  const [highlightedFocus, setHighlightedFocus] = useState<SettingsFocus>();
  // Deep links open the pane that owns the target control, so the first paint
  // already shows the right tab instead of flashing the default one.
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    settingsFocus === "external-lyrics" || settingsFocus === "local-data"
      ? "privacy"
      : "appearance",
  );

  const highlightTimer = useRef<number>();
  // Scroll a section into view and flash it. Shared by the routed deep links
  // (?focus=...) and by the in-page "Tune engine" button. The double frame
  // wait lets a tab switch commit its panel before we look for the anchor.
  const focusSection = useCallback((focus: SettingsFocus) => {
    setHighlightedFocus(focus);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`settings-${focus}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(
      () => setHighlightedFocus(undefined),
      5000,
    );
  }, []);

  useEffect(() => {
    if (!settingsFocus) return;
    // The engine now lives in its own screen rather than a section here, so a
    // deep link to it opens the dialog instead of scrolling to an anchor.
    if (settingsFocus === "recommendation-tuning") {
      openEngine();
      return;
    }
    setActiveTab("privacy");
    focusSection(settingsFocus);
    return () => window.clearTimeout(highlightTimer.current);
  }, [focusSection, openEngine, settingsFocus]);

  const tabs = betaChannel
    ? [
        ...SETTINGS_TABS,
        {
          id: "diagnostics" as const,
          label: "Diagnostics",
          icon: <Gauge size={15} />,
        },
      ]
    : SETTINGS_TABS;

  return (
                <div className="settings-view">
                  <header className="settings-hero">
                    <div className="settings-hero-copy">
                      <p className="settings-hero-kicker">Preferences</p>
                      <h1>Settings</h1>
                      <p>
                        Tune how Volta looks, plays, and personalizes music for
                        you. Everything below stays on this device.
                      </p>
                    </div>
                    <div className="settings-hero-account">
                      <CircleUserRound size={30} />
                      <div>
                        <b>{account.username}</b>
                        <span>
                          {sourceMode === "local" ? "This device" : account.server}
                        </span>
                      </div>
                    </div>
                  </header>

                  <div
                    className="settings-tabs"
                    role="tablist"
                    aria-label="Settings sections"
                  >
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`settings-tab-${tab.id}`}
                        aria-selected={activeTab === tab.id}
                        aria-controls={`settings-panel-${tab.id}`}
                        tabIndex={activeTab === tab.id ? 0 : -1}
                        className={
                          "settings-tab" + (activeTab === tab.id ? " selected" : "")
                        }
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.icon}
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="settings-panels">
                    {activeTab === "appearance" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-appearance"
                      aria-labelledby="settings-tab-appearance"
                    >
                      <h2 className="settings-section-heading">Appearance</h2>
                      <div className="settings-rows">
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="blue">
                            <Palette size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Theme</b>
                            <small>Choose the color scheme</small>
                          </span>
                          <select
                            aria-label="Theme"
                            value={theme}
                            onChange={(event) => setTheme(event.target.value)}
                          >
                            <option value="system">Match system</option>
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                            <option value="high-contrast">High contrast</option>
                          </select>
                        </label>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="indigo">
                            <PanelLeft size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Floating sidebar</b>
                            <small>Inset navigation with rounded corners</small>
                          </span>
                          <input
                            aria-label="Floating sidebar"
                            type="checkbox"
                            checked={floatingSidebar}
                            onChange={(event) => {
                              setFloatingSidebar(event.target.checked);
                              safeWrite(
                                localStorage,
                                "volta-floating-sidebar",
                                String(event.target.checked),
                              );
                            }}
                          />
                        </div>
                        <div className="setting-row setting-action-row">
                          <SettingIcon tone="teal">
                            <Scaling size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Interface scale</b>
                            <small>
                              Currently {interfaceScale}%. Open a full-screen
                              preview to try a size before you keep it.
                            </small>
                          </span>
                          <button
                            className="secondary-button"
                            onClick={beginInterfaceScalePreview}
                          >
                            <Eye size={15} />
                            Preview scale
                          </button>
                        </div>
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="purple">
                            <Sparkles size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Animated artwork</b>
                            <small>Choose where animated artwork is allowed to play</small>
                          </span>
                          <select
                            aria-label="Animated artwork"
                            value={
                              !animatedArtwork
                                ? "off"
                                : animateArtworkEverywhere
                                  ? "everywhere"
                                  : "prominent"
                            }
                            onChange={(event) => {
                              const mode = event.target.value;
                              setAnimatedArtwork(mode !== "off");
                              setAnimateArtworkEverywhere(mode === "everywhere");
                            }}
                          >
                            <option value="prominent">Album and player views</option>
                            <option value="everywhere">Everywhere</option>
                            <option value="off">Off</option>
                          </select>
                        </label>
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="orange">
                            <FlaskConical size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Experimental artwork loading</b>
                            <small>Try aggressive artwork preloading</small>
                          </span>
                          <input
                            aria-label="Experimental artwork loading"
                            type="checkbox"
                            checked={experimentalArtworkLoading}
                            onChange={(event) =>
                              setExperimentalArtworkLoading(event.target.checked)
                            }
                          />
                        </label>
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="green">
                            <RefreshCw size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Refresh collection on Home visits</b>
                            <small>Change “From Your Collection” every time Home opens</small>
                          </span>
                          <input
                            aria-label="Refresh collection on Home visits"
                            type="checkbox"
                            checked={refreshCollectionOnVisit}
                            onChange={(event) =>
                              setRefreshCollectionOnVisit(event.target.checked)
                            }
                          />
                        </label>
                      </div>
                      <p className="settings-section-footer">
                        Shape the look and motion of the player.
                      </p>
                    </section>
                    )}

                    {activeTab === "playback" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-playback"
                      aria-labelledby="settings-tab-playback"
                    >
                      <h2 className="settings-section-heading">Playback</h2>
                      <div className="settings-rows">
                        <label className="setting-row">
                          <SettingIcon tone="blue">
                            <AudioLines size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Streaming quality</b>
                            <small>
                              Original sends the source file to your browser
                            </small>
                          </span>
                          <select
                            aria-label="Streaming quality"
                            value={player.original ? "original" : "compatible"}
                            onChange={(event) =>
                              player.setOriginal(event.target.value === "original")
                            }
                          >
                            <option value="original">Original · no transcoding</option>
                            <option value="compatible">Compatible · MP3 320 kbps</option>
                          </select>
                        </label>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="pink">
                            <InfinityIcon size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Infinite Play</b>
                            <small>Keep the queue filled automatically as it gets low</small>
                          </span>
                          <input
                            aria-label="Infinite Play"
                            type="checkbox"
                            checked={infinitePlayEnabled}
                            disabled={infinitePlayBusy}
                            onChange={toggleInfinitePlay}
                          />
                        </div>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="pink">
                            <ListMusic size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Infinite Play songs</b>
                            <small>Choose how many tracks are added from the floating bar</small>
                          </span>
                          <span className="setting-stepper" aria-label="Infinite Play song count">
                            <button
                              type="button"
                              aria-label="Decrease Infinite Play song count"
                              onClick={() =>
                                setInfinitePlayCount((value) => Math.max(1, value - 1))
                              }
                            >
                              −
                            </button>
                            <output>{infinitePlayCount}</output>
                            <button
                              type="button"
                              aria-label="Increase Infinite Play song count"
                              onClick={() =>
                                setInfinitePlayCount((value) => Math.min(200, value + 1))
                              }
                            >
                              +
                            </button>
                          </span>
                        </div>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="pink">
                            <Shuffle size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Infinite Play source</b>
                            <small>Use your recommendations or choose songs randomly</small>
                          </span>
                          <select
                            aria-label="Infinite Play source"
                            value={infinitePlayMode}
                            onChange={(event) =>
                              setInfinitePlayMode(event.target.value as InfinitePlayMode)
                            }
                          >
                            <option value="algorithm">Algorithm suggestions</option>
                            <option value="random">Random songs</option>
                          </select>
                        </div>
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="orange">
                            <TriangleAlert size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Warn before leaving while playing</b>
                            <small>Ask for confirmation before closing or leaving Volta</small>
                          </span>
                          <input
                            aria-label="Warn before leaving while playing"
                            type="checkbox"
                            checked={warnBeforeLeave}
                            onChange={(event) => setWarnBeforeLeave(event.target.checked)}
                          />
                        </label>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="purple">
                            <Blend size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Song transitions</b>
                            <small>
                              AutoMix blends each pair of songs like a DJ,
                              matching tempo and key. Crossfade uses a fixed
                              length. Off keeps the gapless handoff.
                            </small>
                          </span>
                          <select
                            aria-label="Song transitions"
                            value={transitionMode}
                            onChange={(event) => {
                              const mode = event.target.value as TransitionMode;
                              // Crossfade needs a usable length. Seeding one on
                              // selection beats leaving the stepper at zero.
                              if (mode === "crossfade" && !crossfadeSeconds)
                                setCrossfadeSeconds(6);
                              setTransitionMode(mode);
                            }}
                          >
                            <option value="automix">AutoMix</option>
                            <option value="crossfade">Crossfade</option>
                            <option value="off">Off</option>
                          </select>
                        </div>
                        {transitionMode === "crossfade" && (
                          <div className="setting-row setting-toggle">
                            <SettingIcon tone="purple">
                              <Blend size={16} />
                            </SettingIcon>
                            <span className="setting-copy">
                              <b>Crossfade length</b>
                              <small>
                                How long the two songs overlap. AutoMix ignores
                                this and plans each blend itself.
                              </small>
                            </span>
                            <span
                              className="setting-stepper"
                              aria-label="Crossfade seconds"
                            >
                              <button
                                type="button"
                                aria-label="Decrease crossfade"
                                onClick={() =>
                                  setCrossfadeSeconds((value) =>
                                    Math.max(1, (value || 6) - 1),
                                  )
                                }
                              >
                                −
                              </button>
                              <output>{`${crossfadeSeconds || 6}s`}</output>
                              <button
                                type="button"
                                aria-label="Increase crossfade"
                                onClick={() =>
                                  setCrossfadeSeconds((value) =>
                                    Math.min(12, (value || 6) + 1),
                                  )
                                }
                              >
                                +
                              </button>
                            </span>
                          </div>
                        )}
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="green">
                            <Volume2 size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Volume scroll step</b>
                            <small>Change the volume by this percentage with each scroll</small>
                          </span>
                          <span className="setting-stepper" aria-label="Volume scroll step">
                            <button
                              type="button"
                              aria-label="Decrease volume scroll step"
                              onClick={() =>
                                setVolumeScrollStep((value) => Math.max(1, value - 1))
                              }
                            >
                              −
                            </button>
                            <output>{volumeScrollStep}%</output>
                            <button
                              type="button"
                              aria-label="Increase volume scroll step"
                              onClick={() =>
                                setVolumeScrollStep((value) => Math.min(10, value + 1))
                              }
                            >
                              +
                            </button>
                          </span>
                        </div>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="green">
                            <Volume2 size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Shift + scroll step</b>
                            <small>Change the volume by this percentage while holding Shift</small>
                          </span>
                          <span className="setting-stepper" aria-label="Shift scroll step">
                            <button
                              type="button"
                              aria-label="Decrease Shift scroll step"
                              onClick={() =>
                                setVolumeShiftScrollStep((value) => Math.max(1, value - 1))
                              }
                            >
                              −
                            </button>
                            <output>{volumeShiftScrollStep}%</output>
                            <button
                              type="button"
                              aria-label="Increase Shift scroll step"
                              onClick={() =>
                                setVolumeShiftScrollStep((value) => Math.min(10, value + 1))
                              }
                            >
                              +
                            </button>
                          </span>
                        </div>
                        <div className="setting-row setting-toggle">
                          <SettingIcon tone="green">
                            <Volume2 size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Loudness normalization</b>
                            <small>
                              Match volume across tracks using ReplayGain tags.
                              Requires a server that exposes them.
                            </small>
                          </span>
                          <select
                            aria-label="Loudness normalization"
                            value={normalization}
                            onChange={(event) =>
                              setNormalization(
                                event.target.value as "off" | "track" | "album",
                              )
                            }
                          >
                            <option value="off">Off</option>
                            <option value="track">Track gain</option>
                            <option value="album">Album gain</option>
                          </select>
                        </div>
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="blue">
                            <FileText size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Blur surrounding lyrics</b>
                            <small>Keep nearby lines soft while the current line plays</small>
                          </span>
                          <input
                            aria-label="Blur surrounding lyrics"
                            type="checkbox"
                            checked={lyricsBlurEnabled}
                            onChange={(event) =>
                              setLyricsBlurEnabled(event.target.checked)
                            }
                          />
                        </label>
                      </div>
                      <p className="settings-section-footer">
                        Streaming, queue behavior, and session handling.
                      </p>
                    </section>
                    )}

                    {activeTab === "privacy" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-privacy"
                      aria-labelledby="settings-tab-privacy"
                    >
                      <h2 className="settings-section-heading">Privacy</h2>
                      <div className="settings-rows">
                        <label
                          id="settings-external-lyrics"
                          className={
                            "setting-row setting-toggle" +
                            (highlightedFocus === "external-lyrics"
                              ? " settings-focus-target"
                              : "")
                          }
                        >
                          <SettingIcon tone="blue">
                            <FileText size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>External lyrics lookup</b>
                            <small>
                              When your server has no lyrics, look up song metadata
                              with LRCLIB.
                            </small>
                          </span>
                          <input
                            aria-label="External lyrics lookup"
                            type="checkbox"
                            checked={externalLyricsEnabled}
                            onChange={(event) =>
                              setExternalLyricsEnabled(event.target.checked)
                            }
                          />
                        </label>
                        <label className="setting-row setting-toggle">
                          <SettingIcon tone="purple">
                            <Brain size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Personalized recommendations</b>
                            <small>
                              Keep local listening time, skips, favorites, searches,
                              album views, and the learned model that ties them
                              together.
                            </small>
                          </span>
                          <input
                            aria-label="Personalized recommendations"
                            type="checkbox"
                            checked={listeningHistoryEnabled}
                            onChange={(event) =>
                              setListeningHistoryEnabled(event.target.checked)
                            }
                          />
                        </label>
                        <div
                          id="settings-local-data"
                          className={
                            "setting-row setting-action-row" +
                            (highlightedFocus === "local-data"
                              ? " settings-focus-target"
                              : "")
                          }
                        >
                          <SettingIcon tone="indigo">
                            <Activity size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Listening profile</b>
                            <small>
                              {listeningEvents.length} playback events ·{" "}
                              {engagementEvents.length} interactions ·{" "}
                              {rankerModel.samples} learning samples
                            </small>
                          </span>
                          <div className="setting-action-buttons">
                            <button
                              className="secondary-button"
                              onClick={() => setListeningHistoryOpen(true)}
                            >
                              View profile
                            </button>
                            <button
                              className="secondary-button"
                              disabled={
                                !listeningEvents.length && !engagementEvents.length
                              }
                              onClick={() => {
                                if (trackingKey) {
                                  clearListeningHistory(localStorage, trackingKey);
                                  clearListeningHistory(sessionStorage, trackingKey);
                                }
                                setListeningEvents([]);
                                resetLearning();
                                notify("Your local listening profile was cleared.");
                              }}
                            >
                              Clear data
                            </button>
                          </div>
                        </div>
                        <div className="setting-row setting-action-row">
                          <SettingIcon tone="pink">
                            <SlidersHorizontal size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Recommendation engine</b>
                            <small>
                              Tune how adventurous the shelf is and watch the
                              slate re-rank live.
                            </small>
                          </span>
                          <button
                            className="secondary-button tune-engine-button"
                            onClick={openEngine}
                          >
                            <SlidersHorizontal size={15} />
                            Tune engine
                          </button>
                        </div>
                      </div>
                      <p className="settings-section-footer">
                        What Volta is allowed to remember locally. Nothing is
                        ever sent to Volta.
                      </p>
                    </section>
                    )}

                    {activeTab === "diagnostics" && betaChannel && (
                      <section
                        className="settings-section"
                        role="tabpanel"
                        id="settings-panel-diagnostics"
                        aria-labelledby="settings-tab-diagnostics"
                      >
                        <h2 className="settings-section-heading">Diagnostics</h2>
                        <div className="settings-rows">
                          <label className="setting-row setting-toggle">
                            <SettingIcon tone="orange">
                              <Gauge size={16} />
                            </SettingIcon>
                            <span className="setting-copy">
                              <b>Frame rate monitor</b>
                              <small>
                                Show frame rate, frame-time graph, and the
                                measured frame cadence over the full-screen
                                player. Useful for checking what the animated
                                backdrop costs.
                              </small>
                            </span>
                            <input
                              aria-label="Frame rate monitor"
                              type="checkbox"
                              checked={frameMonitorEnabled}
                              onChange={(event) =>
                                setFrameMonitorEnabled(event.target.checked)
                              }
                            />
                          </label>
                          <div className="setting-row setting-action-row">
                            <SettingIcon tone="gray">
                              <ClipboardCopy size={16} />
                            </SettingIcon>
                            <span className="setting-copy">
                              <b>Copy local diagnostic summary</b>
                              <small>
                                Create a browser, network, and viewport summary
                                for a support report. It stays on this device
                                until you choose where to paste it.
                              </small>
                            </span>
                            <button
                              className="secondary-button"
                              onClick={() => {
                                void navigator.clipboard
                                  .writeText(diagnosticSummary())
                                  .then(() => notify("Diagnostic summary copied."))
                                  .catch(() => notify("Clipboard access was blocked."));
                              }}
                            >
                              Copy summary
                            </button>
                          </div>
                        </div>
                        <p className="settings-section-footer">
                          Development tools. These are only offered on the beta
                          channel.
                        </p>
                      </section>
                    )}

                    {activeTab === "sharing" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-sharing"
                      aria-labelledby="settings-tab-sharing"
                    >
                      <h2 className="settings-section-heading">Sharing</h2>
                      <div className="settings-rows">
                        <label className="setting-row">
                          <SettingIcon tone="green">
                            <Share2 size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Share destination</b>
                            <small>
                              Apple Music looks up a matching catalog link. Spotify shares a direct provider search link.
                            </small>
                          </span>
                          <select
                            aria-label="Share destination"
                            value={shareProvider}
                            onChange={(event) =>
                              setShareProvider(event.target.value as ShareProvider)
                            }
                          >
                            <option value="apple-music">Apple Music</option>
                            <option value="spotify">Spotify</option>
                          </select>
                        </label>
                      </div>
                      <p className="settings-section-footer">
                        Choose where copied music links should open for people
                        outside Volta.
                      </p>
                    </section>
                    )}

                    {activeTab === "keyboard" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-keyboard"
                      aria-labelledby="settings-tab-keyboard"
                    >
                      <h2 className="settings-section-heading">Keyboard</h2>
                      <div className="settings-rows">
                        <div className="setting-row setting-action-row">
                          <SettingIcon tone="indigo">
                            <Keyboard size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Keyboard shortcuts</b>
                            <small>Search, review, and customize every command</small>
                          </span>
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setShortcutQuery("");
                              setRecordingShortcut(null);
                              setShortcutsOpen(true);
                            }}
                          >
                            Open shortcuts
                          </button>
                        </div>
                      </div>
                      <p className="settings-section-footer">
                        Review and remap every command in Volta.
                      </p>
                    </section>
                    )}

                    {activeTab === "help" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-help"
                      aria-labelledby="settings-tab-help"
                    >
                      <h2 className="settings-section-heading">Help and privacy</h2>
                      <div className="settings-rows">
                        <div className="setting-row setting-action-row">
                          <SettingIcon tone="blue">
                            <LifeBuoy size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Help and troubleshooting</b>
                            <small>Connect Navidrome, use local files, and solve common playback issues.</small>
                          </span>
                          <a className="secondary-button" href="/help.html" target="_blank" rel="noreferrer">
                            Open help
                          </a>
                        </div>
                        <div className="setting-row setting-action-row">
                          <SettingIcon tone="gray">
                            <Lock size={16} />
                          </SettingIcon>
                          <span className="setting-copy">
                            <b>Privacy notes</b>
                            <small>See what stays on this device and what optional services receive.</small>
                          </span>
                          <a className="secondary-button" href="/privacy.html" target="_blank" rel="noreferrer">
                            Open privacy
                          </a>
                        </div>
                      </div>
                      <p className="settings-section-footer">
                        Find setup guidance, troubleshooting, and Volta’s privacy notes.
                      </p>
                    </section>
                    )}

                    {activeTab === "account" && (
                    <section
                      className="settings-section"
                      role="tabpanel"
                      id="settings-panel-account"
                      aria-labelledby="settings-tab-account"
                    >
                      <h2 className="settings-section-heading">
                        {sourceMode === "local" ? "Session" : "Navidrome"}
                      </h2>
                      <div className="settings-rows">
                        <div className="setting-row settings-account-row">
                          <span className="settings-account-identity">
                            <CircleUserRound size={32} />
                            <div>
                              <b>{account.username}</b>
                              <span>
                                {sourceMode === "local"
                                  ? "This device"
                                  : account.server}
                              </span>
                            </div>
                          </span>
                          <button className="secondary-button" onClick={disconnect}>
                            Disconnect
                          </button>
                        </div>
                      </div>
                      <p className="settings-section-footer">
                        The library Volta is currently connected to.
                      </p>
                    </section>
                    )}

                    {activeTab === "account" &&
                      sourceMode === "navidrome" &&
                      accounts.length > 0 && (
                      <section
                        className="settings-section"
                        role="tabpanel"
                        id="settings-panel-accounts"
                        aria-labelledby="settings-tab-account"
                      >
                        <h2 className="settings-section-heading">Accounts</h2>
                        <div className="settings-rows">
                          {accounts.map((saved) => {
                            const current =
                              accountKey(saved) ===
                              accountKey({
                                server: account.server,
                                username: account.username,
                              });
                            return (
                              <div
                                className="setting-row settings-account-row"
                                key={accountKey(saved)}
                              >
                                <span className="settings-account-identity">
                                  <CircleUserRound size={28} />
                                  <div>
                                    <b>{saved.username}</b>
                                    <span>
                                      {saved.server.replace(/^https?:\/\//, "")}
                                    </span>
                                  </div>
                                </span>
                                <div className="setting-action-buttons">
                                  <button
                                    className="secondary-button"
                                    disabled={current || connecting}
                                    onClick={() =>
                                      void connect(
                                        {
                                          server: saved.server,
                                          username: saved.username,
                                          password: "",
                                          auth: saved.auth,
                                        },
                                        true,
                                      )
                                    }
                                  >
                                    {current ? "Current" : "Switch"}
                                  </button>
                                  <button
                                    className="secondary-button"
                                    disabled={connecting}
                                    onClick={() => forgetAccount(saved)}
                                  >
                                    Forget
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="settings-section-footer">
                          Libraries you have signed in to. Volta keeps the auth
                          token, not your password.
                        </p>
                      </section>
                    )}
                  </div>
                </div>
  );
}
