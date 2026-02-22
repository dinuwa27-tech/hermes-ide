import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { setSetting } from "../api/settings";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Restore saved window size/position from settings, then start tracking changes. */
export async function restoreWindowState(settings: Record<string, string>): Promise<void> {
  const win = getCurrentWindow();

  const rawW = parseInt(settings.window_width || "", 10);
  const rawH = parseInt(settings.window_height || "", 10);
  const x = parseInt(settings.window_x || "", 10);
  const y = parseInt(settings.window_y || "", 10);

  if (rawW > 0 && rawH > 0) {
    const w = Math.max(rawW, 600);
    const h = Math.max(rawH, 400);
    await win.setSize(new LogicalSize(w, h));
  }
  if (!isNaN(x) && !isNaN(y)) {
    await win.setPosition(new LogicalPosition(x, y));
  }

  startTracking();
}

function startTracking(): void {
  const win = getCurrentWindow();

  const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        const factor = await win.scaleFactor();
        // Convert physical to logical
        const lw = Math.round(size.width / factor);
        const lh = Math.round(size.height / factor);
        const lx = Math.round(pos.x / factor);
        const ly = Math.round(pos.y / factor);

        setSetting("window_width", String(lw)).catch(() => {});
        setSetting("window_height", String(lh)).catch(() => {});
        setSetting("window_x", String(lx)).catch(() => {});
        setSetting("window_y", String(ly)).catch(() => {});
      } catch {
        /* window may be closing */
      }
    }, 500);
  };

  win.onResized(save);
  win.onMoved(save);
}
