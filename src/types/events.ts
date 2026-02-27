// ─── Event Types ─────────────────────────────────────────────────────

export interface CommandPredictionEvent {
  predictions: { next_command: string; frequency: number }[];
}
