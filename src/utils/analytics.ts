import { init, trackEvent } from "@aptabase/web";
import { getSetting } from "../api/settings";
import { getVersion } from "@tauri-apps/api/app";

let _enabled: boolean | null = null;
let _initialized = false;

async function ensureInit(): Promise<void> {
  if (_initialized) return;
  try {
    const version = await getVersion();
    init("A-EU-1922161061", { appVersion: version });
    _initialized = true;
  } catch { /* silent */ }
}

export async function initAnalytics(): Promise<void> {
  try {
    const val = await getSetting("telemetry_enabled");
    _enabled = val !== "false";
  } catch {
    _enabled = true;
  }
  if (_enabled) {
    await ensureInit();
  }
}

export function setAnalyticsEnabled(enabled: boolean): void {
  _enabled = enabled;
  if (enabled && !_initialized) {
    ensureInit();
  }
}

export function track(name: string, props?: Record<string, string | number>): void {
  if (_enabled === false) return;
  try { trackEvent(name, props); } catch { /* silent */ }
}

export function trackAppStarted(): void { track("app_started"); }

export function trackSessionCreated(props: {
  execution_mode: string;
  has_ai_provider: boolean;
}): void {
  track("session_created", {
    execution_mode: props.execution_mode,
    has_ai_provider: props.has_ai_provider ? 1 : 0,
  });
}

export function trackFeatureUsed(feature: string): void {
  track("feature_used", { feature });
}
