export type ShortcutId =
  | "playPause"
  | "previousTrack"
  | "nextTrack"
  | "seekBackward"
  | "seekForward"
  | "volumeDown"
  | "volumeUp"
  | "mute"
  | "shuffle"
  | "repeat"
  | "favorite"
  | "focusSearch"
  | "focusFilter"
  | "toggleSidebar"
  | "goHome"
  | "goRecent"
  | "goPlayed"
  | "goAlbums"
  | "goArtists"
  | "goSongs"
  | "goFolders"
  | "goFavorites"
  | "goPlaylists"
  | "goBack"
  | "refresh"
  | "toggleQueue"
  | "toggleLyrics"
  | "openPlayer"
  | "openSettings"
  | "openShortcuts"
  | "closeOverlays"
  | "scrollTop";

export type ShortcutBinding = {
  code: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type ShortcutDefinition = {
  id: ShortcutId;
  category: string;
  label: string;
  description: string;
  defaultBinding: ShortcutBinding;
};

export const SHORTCUT_STORAGE_KEY = "volta-keyboard-shortcuts";

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "playPause",
    category: "Playback",
    label: "Play or pause",
    description: "Toggle the current track.",
    defaultBinding: { code: "Space" },
  },
  {
    id: "previousTrack",
    category: "Playback",
    label: "Previous track",
    description: "Go back, or restart the current track when near the beginning.",
    defaultBinding: { code: "BracketLeft" },
  },
  {
    id: "nextTrack",
    category: "Playback",
    label: "Next track",
    description: "Play the next track in the queue.",
    defaultBinding: { code: "BracketRight" },
  },
  {
    id: "seekBackward",
    category: "Playback",
    label: "Seek backward",
    description: "Move back ten seconds.",
    defaultBinding: { code: "KeyJ" },
  },
  {
    id: "seekForward",
    category: "Playback",
    label: "Seek forward",
    description: "Move forward ten seconds.",
    defaultBinding: { code: "KeyL" },
  },
  {
    id: "volumeDown",
    category: "Playback",
    label: "Lower volume",
    description: "Lower volume by five percent.",
    defaultBinding: { code: "Minus" },
  },
  {
    id: "volumeUp",
    category: "Playback",
    label: "Raise volume",
    description: "Raise volume by five percent.",
    defaultBinding: { code: "Equal" },
  },
  {
    id: "mute",
    category: "Playback",
    label: "Mute or unmute",
    description: "Toggle audio mute.",
    defaultBinding: { code: "KeyM" },
  },
  {
    id: "shuffle",
    category: "Playback",
    label: "Toggle shuffle",
    description: "Turn shuffle on or off.",
    defaultBinding: { code: "KeyS" },
  },
  {
    id: "repeat",
    category: "Playback",
    label: "Cycle repeat",
    description: "Cycle off, repeat all, and repeat one.",
    defaultBinding: { code: "KeyR" },
  },
  {
    id: "favorite",
    category: "Playback",
    label: "Favorite current track",
    description: "Add or remove the current track from favorites.",
    defaultBinding: { code: "KeyF" },
  },
  {
    id: "focusSearch",
    category: "Search and navigation",
    label: "Search library",
    description: "Open library search and focus its field.",
    defaultBinding: { code: "KeyK", mod: true },
  },
  {
    id: "focusFilter",
    category: "Search and navigation",
    label: "Filter current view",
    description: "Focus the filter for the current library view.",
    defaultBinding: { code: "Slash" },
  },
  {
    id: "toggleSidebar",
    category: "Search and navigation",
    label: "Collapse or expand navigation",
    description:
      "Shrink the sidebar to an icon rail, or restore it. On a narrow window it opens or closes the navigation drawer.",
    defaultBinding: { code: "KeyB", mod: true },
  },
  {
    id: "goHome",
    category: "Search and navigation",
    label: "Go to Home",
    description: "Open the Home view.",
    defaultBinding: { code: "Digit1", mod: true },
  },
  {
    id: "goRecent",
    category: "Search and navigation",
    label: "Go to New in Your Library",
    description: "Open recently added albums.",
    defaultBinding: { code: "Digit2", mod: true },
  },
  {
    id: "goPlayed",
    category: "Search and navigation",
    label: "Go to Recently Played",
    description: "Open recently played albums.",
    defaultBinding: { code: "Digit3", mod: true },
  },
  {
    id: "goAlbums",
    category: "Search and navigation",
    label: "Go to Albums",
    description: "Open the album library.",
    defaultBinding: { code: "Digit4", mod: true },
  },
  {
    id: "goArtists",
    category: "Search and navigation",
    label: "Go to Artists",
    description: "Open the artist library.",
    defaultBinding: { code: "Digit5", mod: true },
  },
  {
    id: "goSongs",
    category: "Search and navigation",
    label: "Go to Songs",
    description: "Open the song library.",
    defaultBinding: { code: "Digit6", mod: true },
  },
  {
    id: "goFolders",
    category: "Search and navigation",
    label: "Go to Folders",
    description: "Browse the library by folder.",
    defaultBinding: { code: "Digit7", mod: true },
  },
  {
    id: "goFavorites",
    category: "Search and navigation",
    label: "Go to Favorite Songs",
    description: "Open your favorite tracks.",
    defaultBinding: { code: "Digit8", mod: true },
  },
  {
    id: "goPlaylists",
    category: "Search and navigation",
    label: "Go to Playlists",
    description: "Open your playlists.",
    defaultBinding: { code: "Digit9", mod: true },
  },
  {
    id: "goBack",
    category: "Search and navigation",
    label: "Go back",
    description: "Return to the previous library view.",
    defaultBinding: { code: "ArrowLeft", mod: true },
  },
  {
    id: "refresh",
    category: "Search and navigation",
    label: "Refresh current view",
    description: "Reload the current library data.",
    defaultBinding: { code: "KeyR", mod: true },
  },
  {
    id: "scrollTop",
    category: "Search and navigation",
    label: "Scroll to top",
    description: "Return the current library view to its top.",
    defaultBinding: { code: "Home" },
  },
  {
    id: "toggleQueue",
    category: "Player and panels",
    label: "Show or hide queue",
    description: "Open the Playing Next panel.",
    defaultBinding: { code: "KeyQ" },
  },
  {
    id: "toggleLyrics",
    category: "Player and panels",
    label: "Show or hide lyrics",
    description: "Open the lyrics panel.",
    defaultBinding: { code: "KeyY" },
  },
  {
    id: "openPlayer",
    category: "Player and panels",
    label: "Open Now Playing",
    description: "Expand the full-screen player.",
    defaultBinding: { code: "KeyO" },
  },
  {
    id: "closeOverlays",
    category: "Player and panels",
    label: "Close panel or player",
    description: "Close the full player, panel, sidebar, or menu.",
    defaultBinding: { code: "Escape" },
  },
  {
    id: "openSettings",
    category: "Application",
    label: "Open Settings",
    description: "Open Volta settings.",
    defaultBinding: { code: "Comma", mod: true },
  },
  {
    id: "openShortcuts",
    category: "Application",
    label: "Show keyboard shortcuts",
    description: "Open this searchable shortcut reference and editor.",
    defaultBinding: { code: "Slash", shift: true },
  },
];

export type ShortcutBindings = Record<ShortcutId, ShortcutBinding>;

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map(({ id, defaultBinding }) => [id, defaultBinding]),
) as ShortcutBindings;

export function readShortcutBindings(storage: Storage): ShortcutBindings {
  try {
    const raw = storage.getItem(SHORTCUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutId, ShortcutBinding>>;
    return SHORTCUT_DEFINITIONS.reduce((bindings, definition) => {
      const candidate = parsed[definition.id];
      bindings[definition.id] =
        candidate && typeof candidate.code === "string"
          ? {
              code: candidate.code,
              mod: Boolean(candidate.mod),
              shift: Boolean(candidate.shift),
              alt: Boolean(candidate.alt),
            }
          : { ...definition.defaultBinding };
      return bindings;
    }, {} as ShortcutBindings);
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export function bindingFromKeyboardEvent(
  event: KeyboardEvent,
): ShortcutBinding {
  return {
    code: event.code,
    mod: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export function shortcutMatches(
  event: KeyboardEvent,
  binding: ShortcutBinding,
) {
  return (
    event.code === binding.code &&
    Boolean(binding.mod) === (event.ctrlKey || event.metaKey) &&
    Boolean(binding.shift) === event.shiftKey &&
    Boolean(binding.alt) === event.altKey
  );
}

const CODE_LABELS: Record<string, string> = {
  Space: "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Minus: "−",
  Equal: "=",
  Escape: "Esc",
  Enter: "Enter",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Backspace: "Backspace",
};

function codeLabel(code: string) {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

export function platformModifierLabel() {
  if (typeof navigator === "undefined") return "Super";
  const navigatorWithPlatform = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = [
    navigator.platform,
    navigator.userAgent,
    navigatorWithPlatform.userAgentData?.platform,
  ]
    .filter(Boolean)
    .join(" ");
  const appleTouchDevice =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (appleTouchDevice || /Mac|iPhone|iPad|iPod/i.test(platform)) return "⌘";
  if (/Win/i.test(platform)) return "Windows";
  return "Super";
}

export function formatShortcut(binding: ShortcutBinding) {
  const modifiers = [
    binding.mod ? platformModifierLabel() : "",
    binding.shift ? "Shift" : "",
    binding.alt ? "Alt" : "",
  ].filter(Boolean);
  return [...modifiers, codeLabel(binding.code)].join(" ");
}

export function bindingSignature(binding: ShortcutBinding) {
  return [
    binding.code,
    binding.mod ? "mod" : "",
    binding.shift ? "shift" : "",
    binding.alt ? "alt" : "",
  ].join("+");
}
