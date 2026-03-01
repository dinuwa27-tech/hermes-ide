import "../styles/components/UpdateDialog.css";
import { open } from "@tauri-apps/plugin-shell";
import type { UpdateState } from "../hooks/useAutoUpdater";

interface UpdateDialogProps {
  state: UpdateState;
  onDismiss: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

export function UpdateDialog({ state, onDismiss, onDownload, onInstall }: UpdateDialogProps) {
  if (!state.available || state.dismissed) return null;

  return (
    <div className="update-dialog-backdrop" onClick={state.downloading ? undefined : onDismiss}>
      <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-dialog-header">
          <span className="update-dialog-title">
            {state.ready ? "Ready to Install" : "Update Available"}
          </span>
          <span className="update-dialog-tag">v{state.version}</span>
        </div>
        <div className="update-dialog-subtitle">
          You&rsquo;re currently on v{__APP_VERSION__}
        </div>

        {state.notes && (
          <div className="update-dialog-notes">{state.notes}</div>
        )}

        {state.downloading && (
          <div className="update-dialog-progress">
            <div className="update-dialog-progress-bar">
              <div
                className="update-dialog-progress-fill"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <div className="update-dialog-progress-label">
              Downloading... {state.progress}%
            </div>
          </div>
        )}

        {state.ready && !state.error && (
          <div className="update-dialog-ready">
            Download complete. Click below to install and restart.
          </div>
        )}

        {state.error && !state.downloading && (
          <div className="update-dialog-error">
            {state.ready ? "Install failed. Try again." : "Download failed. Check your connection and try again."}
          </div>
        )}

        <div className="update-dialog-actions">
          <button
            className="update-dialog-btn"
            onClick={() => open("https://hermes-ide.com/changelog")}
          >
            Changelog
          </button>

          {!state.downloading && (
            <button className="update-dialog-btn" onClick={onDismiss}>
              Later
            </button>
          )}

          {state.ready ? (
            <button
              className="update-dialog-btn update-dialog-btn-primary"
              onClick={onInstall}
            >
              Install &amp; Relaunch
            </button>
          ) : (
            <button
              className="update-dialog-btn update-dialog-btn-primary"
              onClick={onDownload}
              disabled={state.downloading}
            >
              {state.downloading ? "Downloading..." : state.error ? "Retry" : "Update Now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
