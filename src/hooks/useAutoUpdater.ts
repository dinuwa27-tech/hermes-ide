import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  /** An update is available */
  available: boolean;
  /** Version string of the available update */
  version: string;
  /** Release notes markdown */
  notes: string;
  /** Currently downloading */
  downloading: boolean;
  /** Download progress 0-100 */
  progress: number;
  /** Download finished, ready to install */
  ready: boolean;
  /** User dismissed the dialog — hide until next launch */
  dismissed: boolean;
  /** The version string the user dismissed (so a newer version re-shows the dialog) */
  dismissedVersion: string;
  /** Download failed — show error feedback */
  error: boolean;
}

const INITIAL: UpdateState = {
  available: false,
  version: "",
  notes: "",
  downloading: false,
  progress: 0,
  ready: false,
  dismissed: false,
  dismissedVersion: "",
  error: false,
};

const CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function useAutoUpdater() {
  const [state, setState] = useState<UpdateState>(INITIAL);
  const updateRef = useRef<Update | null>(null);

  const doCheck = useCallback(async () => {
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setState((s) => ({
          ...s,
          available: true,
          version: update.version,
          notes: update.body ?? "",
          error: false,
          // If the user dismissed an older version, re-show for the new one
          dismissed: s.dismissed && s.dismissedVersion === update.version,
        }));
      }
    } catch {
      // Fail silently — no internet, endpoint down, dev mode, etc.
    }
  }, []);

  // Check on launch (after delay) + periodically
  useEffect(() => {
    const timeout = setTimeout(doCheck, CHECK_DELAY_MS);
    const interval = setInterval(doCheck, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [doCheck]);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, dismissed: true, dismissedVersion: s.version }));
  }, []);

  const download = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((s) => ({ ...s, downloading: true, progress: 0, error: false }));

    try {
      let contentLength = 0;
      let downloaded = 0;

      await update.download((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0;
            setState((s) => ({ ...s, progress: pct }));
            break;
          }
          case "Finished":
            break;
        }
      });
      // Download complete — wait for user to press "Install & Relaunch"
      setState((s) => ({ ...s, downloading: false, progress: 100, ready: true }));
    } catch {
      setState((s) => ({ ...s, downloading: false, error: true }));
    }
  }, []);

  const installAndRelaunch = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    try {
      await update.install();
      await relaunch();
    } catch {
      setState((s) => ({ ...s, error: true, ready: false }));
    }
  }, []);

  const manualCheck = useCallback(async () => {
    setState((s) => ({ ...s, dismissed: false }));
    await doCheck();
    // Return whether an update was found
    return updateRef.current !== null;
  }, [doCheck]);

  return { state, dismiss, download, installAndRelaunch, manualCheck };
}
