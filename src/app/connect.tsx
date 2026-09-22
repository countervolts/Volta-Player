import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type RefObject,
} from "react";
import {
  CircleUserRound,
  Eye,
  EyeOff,
  FolderOpen,
  LoaderCircle,
  Play,
  X,
} from "lucide-react";
import { type ConnectionIssue, type Credentials } from "../lib/navidrome";
import { type LocalMusicLibrary } from "../lib/local-music";
import { IconButton, Tooltip } from "../components";
import { ConnectionHelp } from "./app-views";
import {
  accountKey,
  LOGIN_DRAFT_KEY,
  readLoginDraft,
  readRememberedCredentials,
  safeRead,
  safeWrite,
  type LoginDraft,
  type SavedAccount,
} from "./app-storage";

export function Connect({
  onConnect,
  busy,
  error,
  diagnosis,
  onDismissDiagnosis,
  accounts,
  onUseAccount,
  onForgetAccount,
  localMusic,
  localMusicBusy,
  localMusicError,
  localMusicInputRef,
  onChooseLocalMusic,
  onImportLocalMusic,
  onOpenLocalMusic,
}: {
  onConnect: (credentials: Credentials, rememberMe: boolean) => void;
  busy: boolean;
  error: string;
  diagnosis: ConnectionIssue | null;
  onDismissDiagnosis: () => void;
  accounts: SavedAccount[];
  onUseAccount: (account: SavedAccount) => void;
  onForgetAccount: (account: SavedAccount) => void;
  localMusic: LocalMusicLibrary | null;
  localMusicBusy: boolean;
  localMusicError: string;
  localMusicInputRef: RefObject<HTMLInputElement>;
  onChooseLocalMusic: () => void;
  onImportLocalMusic: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>;
  onOpenLocalMusic: () => void;
}) {
  const [draft] = useState(readLoginDraft);
  const [server, setServer] = useState(() =>
    draft.server ||
      safeRead(localStorage, "volta-server") ||
      readRememberedCredentials()?.server ||
      "",
  );
  const [username, setUsername] = useState(() =>
    draft.username ||
      safeRead(localStorage, "volta-username") ||
      readRememberedCredentials()?.username ||
      "",
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [source, setSource] = useState<"navidrome" | "local">("navidrome");
  const [rememberMe, setRememberMe] = useState(
    () => safeRead(localStorage, "volta-remember-me") === "true",
  );
  const saveDraft = (next: Partial<LoginDraft>) => {
    safeWrite(
      sessionStorage,
      LOGIN_DRAFT_KEY,
      JSON.stringify({ server, username, ...next }),
    );
  };
  useEffect(() => {
    safeWrite(
      sessionStorage,
      LOGIN_DRAFT_KEY,
      JSON.stringify({ server, username }),
    );
  }, [server, username]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConnect({ server, username, password }, rememberMe);
  };
  const tryDemo = () =>
    onConnect(
      {
        server: "https://demo.navidrome.org",
        username: "demo",
        password: "demo",
      },
      false,
    );
  return (
    <main className="connect-screen">
      <div className="connect-brand">
        <img className="brand-bolt" src="/volta-bolt.svg" alt="" />
        <span>Volta</span>
      </div>
      <form className="connect-form" onSubmit={submit}>
        <div className="connect-icon">
          <img src="/volta-bolt.svg" alt="Volta" />
        </div>
        <h1>Volta</h1>
        <p>
          {source === "local"
            ? "Play music from a folder on this device."
            : "Connect to Navidrome to start listening."}
        </p>
        <div
          className={`connect-source-switch${
            source === "local" ? " local-selected" : ""
          }`}
          aria-label="Music source"
        >
          <button
            className={source === "navidrome" ? "selected" : ""}
            type="button"
            aria-pressed={source === "navidrome"}
            onClick={() => setSource("navidrome")}
          >
            Navidrome
          </button>
          <button
            className={source === "local" ? "selected" : ""}
            type="button"
            aria-pressed={source === "local"}
            onClick={() => setSource("local")}
          >
            This device
          </button>
        </div>
        <input
          ref={localMusicInputRef}
          className="visually-hidden"
          type="file"
          multiple
          aria-label="Choose music folder"
          onChange={(event) => void onImportLocalMusic(event)}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        {source === "local" ? (
          <div className="connect-source-panel" key={source}>
            <div className="connect-local-source">
              <div className="connect-local-source-copy">
                <FolderOpen size={18} />
                <span>
                  <b>{localMusic?.directoryName || "No folder selected"}</b>
                  <small>
                    {localMusic
                      ? `${localMusic.tracks.length} supported tracks ready`
                      : "Choose your music folder to continue. (no music is uploaded)"}
                  </small>
                </span>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || localMusicBusy}
                onClick={() => void onChooseLocalMusic()}
              >
                <FolderOpen size={14} />
                {localMusicBusy
                  ? "Reading…"
                  : localMusic
                    ? "Change folder"
                    : "Choose folder"}
              </button>
            </div>
            {localMusicError && (
              <p className="connect-local-error" role="alert">
                {localMusicError}
              </p>
            )}
            <button
              className="primary-button connect-submit"
              type="button"
              disabled={busy || localMusicBusy || !localMusic?.tracks.length}
              onClick={onOpenLocalMusic}
            >
              Open local library
            </button>
            <button
              className="demo-button"
              type="button"
              disabled={busy || localMusicBusy}
              onClick={() => setSource("navidrome")}
            >
              Use Navidrome instead
            </button>
          </div>
        ) : (
          <div className="connect-source-panel" key={source}>
          <div className="connection-fields">
          <label>
            Server
            <input
              required
              autoComplete="url"
              placeholder="https://music.example.com"
              value={server}
              onChange={(event) => {
                const value = event.target.value;
                setServer(value);
                saveDraft({ server: value });
              }}
            />
          </label>
          <label>
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => {
                const value = event.target.value;
                setUsername(value);
                saveDraft({ username: value });
              }}
              placeholder="Username"
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                required
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  const value = event.target.value;
                  setPassword(value);
                }}
                placeholder="Password"
              />
              <Tooltip label={showPassword ? "Hide password" : "Show password"}>
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </Tooltip>
            </span>
          </label>
          </div>
          <label className="remember-row">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
          />
          <span>Remember this sign-in on this device</span>
          </label>
          {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
          )}
          {diagnosis && diagnosis !== "network" && (
            <ConnectionHelp
              diagnosis={diagnosis}
              server={server}
              onDismiss={onDismissDiagnosis}
            />
          )}
          <button
            className="primary-button connect-submit"
            type="submit"
            disabled={busy}
          >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
          </button>
          {accounts.length > 0 && (
            <div className="saved-accounts">
              <p className="saved-accounts-title">Saved libraries</p>
              {accounts.map((account) => (
                <div className="saved-account" key={accountKey(account)}>
                  <button
                    className="saved-account-use"
                    type="button"
                    disabled={busy}
                    onClick={() => onUseAccount(account)}
                  >
                    <span className="saved-account-icon" aria-hidden="true">
                      <CircleUserRound size={19} />
                    </span>
                    <span className="saved-account-copy">
                      <b>{account.username}</b>
                      <small>
                        <span className="saved-account-kind">Navidrome</span>
                        <span aria-hidden="true"> · </span>
                        {account.server.replace(/^https?:\/\//, "")}
                      </small>
                    </span>
                  </button>
                  <IconButton
                    label={`Forget ${account.username} on ${account.server}`}
                    disabled={busy}
                    onClick={() => onForgetAccount(account)}
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
          <button
          className="demo-button"
          type="button"
          disabled={busy}
          onClick={tryDemo}
        >
          <Play size={14} fill="currentColor" />
          Try the Navidrome demo
          </button>
          </div>
        )}
      </form>
      <footer className="connect-footer">
        <a href="/help.html">Help and troubleshooting</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy.html">Privacy</a>
      </footer>
    </main>
  );
}
