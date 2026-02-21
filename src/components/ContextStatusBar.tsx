import "../styles/components/ContextStatusBar.css";
import { type ContextManager } from "../hooks/useContextState";

interface ContextStatusBarProps {
  manager: ContextManager;
  autoApplyEnabled: boolean;
  onToggleAutoApply: () => void;
  onApply?: () => Promise<void>;
}

export function ContextStatusBar({ manager, autoApplyEnabled, onToggleAutoApply, onApply }: ContextStatusBarProps) {
  const { injectedVersion, lifecycle, lastError, applyContext,
          tokenBudget, estimatedTokens } = manager;

  const isDirty = lifecycle === 'dirty' || lifecycle === 'apply_failed';
  const isApplying = lifecycle === 'applying';

  const budgetPercent = tokenBudget > 0 ? Math.min(100, Math.round((estimatedTokens / tokenBudget) * 100)) : 0;
  const budgetWarning = budgetPercent >= 80;
  const budgetCritical = budgetPercent >= 95;

  const barClass = [
    "ctx-status-bar",
    isDirty ? "ctx-status-bar-outofsync" : "",
    isApplying ? "ctx-status-bar-applying" : "",
    lifecycle === 'apply_failed' ? "ctx-status-bar-failed" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={barClass}>
      <div className="ctx-status-row">
        <div className="ctx-status-left">
          {lifecycle === 'dirty' && (
            <span className="ctx-outofsync-indicator">
              Out of sync
            </span>
          )}
          {lifecycle === 'applying' && (
            <span className="ctx-applying-indicator">
              Applying...
            </span>
          )}
          {lifecycle === 'apply_failed' && (
            <span className="ctx-failed-indicator">
              Failed
            </span>
          )}
          {lifecycle === 'clean' && injectedVersion > 0 && (
            <span className="ctx-insync-indicator">
              In sync
            </span>
          )}
          {lifecycle === 'clean' && injectedVersion === 0 && (
            <span className="ctx-insync-indicator">
              Ready
            </span>
          )}
        </div>
        <div className="ctx-status-right">
          <button
            className="ctx-apply-btn"
            onClick={() => { (onApply || applyContext)().catch(console.error); }}
            disabled={lifecycle === 'clean' || lifecycle === 'applying'}
          >
            {isApplying ? "Applying..." : "Apply Context"}
          </button>
        </div>
      </div>

      {/* Token budget meter */}
      <div className="ctx-budget-row">
        <div className="ctx-budget-bar-track">
          <div
            className={[
              "ctx-budget-bar-fill",
              budgetCritical ? "ctx-budget-bar-critical" : budgetWarning ? "ctx-budget-bar-warning" : "",
            ].filter(Boolean).join(" ")}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>
        <span className={`ctx-budget-label ${budgetCritical ? "ctx-budget-critical" : budgetWarning ? "ctx-budget-warning" : ""}`}>
          ~{estimatedTokens.toLocaleString()} / {tokenBudget.toLocaleString()} tokens ({budgetPercent}%)
        </span>
      </div>

      {/* Error message */}
      {lifecycle === 'apply_failed' && lastError && (
        <div className="ctx-apply-error">
          {lastError}
        </div>
      )}

      {/* Auto-apply toggle */}
      <div className="ctx-autoapply-row">
        <label className="ctx-autoapply-label">
          <input
            type="checkbox"
            checked={autoApplyEnabled}
            onChange={onToggleAutoApply}
            className="ctx-autoapply-checkbox"
          />
          Auto-apply on execution
        </label>
      </div>
    </div>
  );
}
