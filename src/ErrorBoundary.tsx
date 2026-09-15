import { Component, type ErrorInfo, type ReactNode } from "react";
import { alternateVersion } from "./version-handoff";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console trail for local debugging; nothing is uploaded.
    console.error("Volta crashed while rendering:", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // On the production hosts this points at the other channel, so a broken
    // release still has a working way out.
    const alternate = alternateVersion();
    return (
      <main className="crash-screen" role="alert">
        <div className="crash-card">
          <p className="crash-kicker">Something went wrong</p>
          <h1>Volta hit an unexpected error</h1>
          <p className="crash-message">
            Your music and sign-in are safe. Try again, and if the problem keeps
            happening, reload the player.
          </p>
          {alternate && (
            <p className="crash-message">
              You can also open the other release channel while this one is
              fixed.
            </p>
          )}
          <pre className="crash-detail">{error.message || String(error)}</pre>
          <div className="crash-actions">
            {alternate && (
              <a className="secondary-button crash-channel" href={alternate.url}>
                {alternate.label}
              </a>
            )}
            <button className="secondary-button" onClick={this.reload}>
              Reload Volta
            </button>
            <button className="primary-button" onClick={this.retry}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }
}
