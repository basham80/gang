import { Bell, CheckCheck, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  AlertMetric,
  AlertRule,
  SolanaToken,
  TriggeredAlert,
} from '../types/solana';
import {
  formatCompactUsd,
  formatRelativeTime,
  formatUsd,
  resolveTokenAddressBySymbol,
  validateAlertInput,
  type SolanaCluster,
} from '../utils/solanaLogic';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface AlertsViewProps {
  tokens: SolanaToken[];
  network?: SolanaCluster;
  rules: AlertRule[];
  triggered: TriggeredAlert[];
  preselectedSymbol: string | null;
  onAddRule: (tokenSymbol: string, metric: AlertMetric, threshold: number) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onAcknowledgeAll: () => void;
  onEvaluateNow: () => void;
}

const METRIC_LABELS: Record<AlertMetric, string> = {
  price_above: 'Price Above (USD)',
  price_below: 'Price Below (USD)',
  change1h_above: '1h Gain Above (%)',
  volume_above: '24h Volume Above (USD)',
};

export function AlertsView({
  tokens,
  network = 'Mainnet-Beta',
  rules,
  triggered,
  preselectedSymbol,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  onAcknowledgeAll,
  onEvaluateNow,
}: AlertsViewProps) {
  const [tokenSymbol, setTokenSymbol] = useState<string>(
    preselectedSymbol || tokens[0]?.symbol || 'SOL'
  );
  const [metric, setMetric] = useState<AlertMetric>('price_above');
  const [thresholdStr, setThresholdStr] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const selectedToken = tokens.find((t) => t.symbol === tokenSymbol);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = Number(thresholdStr);
    const check = validateAlertInput(tokenSymbol, metric, parsed);
    if (!check.valid) {
      setError(check.error ?? 'Enter a valid alert threshold.');
      return;
    }
    onAddRule(tokenSymbol, metric, parsed);
    setThresholdStr('');
  };

  const formatThreshold = (rule: AlertRule) => {
    if (rule.metric === 'change1h_above') return `+${rule.threshold}%`;
    if (rule.metric === 'volume_above') return formatCompactUsd(rule.threshold);
    return formatUsd(rule.threshold);
  };

  const openCount = triggered.filter((t) => !t.acknowledged).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50">
            Automated Alerts
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Define price, 1-hour breakout, and liquidity-volume triggers that evaluate continuously against live Solana feeds.
          </p>
        </div>

        <button
          type="button"
          onClick={onEvaluateNow}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-slate-700 text-xs sm:text-sm font-medium text-slate-200 transition-colors self-start sm:self-auto whitespace-nowrap"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" />
          <span>Evaluate Rules Now</span>
        </button>
      </div>

      {/* Create Alert Rule Form */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Create Automated Rule
          </h2>
          {selectedToken && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {selectedToken.symbol} now {formatUsd(selectedToken.priceUsd)} · 1h{' '}
                {selectedToken.change1h >= 0 ? '+' : ''}
                {selectedToken.change1h.toFixed(2)}%
              </span>
              <TokenExplorerLinks
                address={selectedToken.address}
                symbol={selectedToken.symbol}
                network={network}
                variant="compact"
              />
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label
              htmlFor="alert-token-select"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Solana Token
            </label>
            <select
              id="alert-token-select"
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
            >
              {tokens.map((t) => (
                <option key={t.address} value={t.symbol}>
                  {t.symbol} — {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="alert-metric-select"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Trigger Condition
            </label>
            <select
              id="alert-metric-select"
              value={metric}
              onChange={(e) => setMetric(e.target.value as AlertMetric)}
              className="w-full px-3 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
            >
              {(Object.keys(METRIC_LABELS) as AlertMetric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="alert-threshold-input"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Threshold Value
            </label>
            <input
              id="alert-threshold-input"
              type="number"
              step="any"
              value={thresholdStr}
              onChange={(e) => setThresholdStr(e.target.value)}
              placeholder={
                metric === 'change1h_above'
                  ? 'e.g. 5'
                  : metric === 'volume_above'
                    ? 'e.g. 100000000'
                    : 'e.g. 180'
              }
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm font-mono tabular-nums text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap"
          >
            Add Alert Rule
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Active Rules */}
        <section className="lg:col-span-7 rounded-xl bg-[#0F1624] border border-slate-800/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Configured Rules
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {rules.length} rules
            </span>
          </div>

          {rules.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              No automated rules configured. Add your first Solana alert rule above.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-display font-semibold text-slate-100">
                        {rule.tokenSymbol}
                      </span>
                      <span className="text-slate-400">
                        {METRIC_LABELS[rule.metric]}
                      </span>
                      <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                        {formatThreshold(rule)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        {rule.active ? 'Monitoring active' : 'Paused'} · Triggered{' '}
                        {rule.triggeredCount}x
                      </span>
                      {(() => {
                        const mint = resolveTokenAddressBySymbol(
                          rule.tokenSymbol,
                          tokens
                        );
                        return mint ? (
                          <TokenExplorerLinks
                            address={mint}
                            symbol={rule.tokenSymbol}
                            network={network}
                            variant="compact"
                          />
                        ) : null;
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleRule(rule.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        rule.active
                          ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                          : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                      }`}
                    >
                      {rule.active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteRule(rule.id)}
                      aria-label={`Delete alert rule for ${rule.tokenSymbol}`}
                      className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Triggered Alerts Feed */}
        <section className="lg:col-span-5 rounded-xl bg-[#0F1624] border border-slate-800/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" />
              <h2 className="font-display text-base font-semibold text-slate-100">
                Triggered Events
              </h2>
            </div>
            {openCount > 0 && (
              <button
                type="button"
                onClick={onAcknowledgeAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read ({openCount})</span>
              </button>
            )}
          </div>

          {triggered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No alerts triggered yet. Active rules automatically fire when live Solana prices or volume cross your target threshold.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {triggered.map((item) => (
                <div
                  key={item.id}
                  className={`px-5 py-3.5 space-y-1 ${
                    item.acknowledged ? 'opacity-65' : 'bg-amber-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`font-semibold ${
                        item.acknowledged ? 'text-slate-400' : 'text-amber-400'
                      }`}
                    >
                      {item.acknowledged ? 'Acknowledged' : 'Triggered'} · {item.tokenSymbol}
                    </span>
                    <span className="text-slate-500">
                      {formatRelativeTime(item.triggeredAt)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 leading-snug">
                    {item.message}
                  </p>
                  {(() => {
                    const mint = resolveTokenAddressBySymbol(
                      item.tokenSymbol,
                      tokens
                    );
                    return mint ? (
                      <div className="pt-0.5">
                        <TokenExplorerLinks
                          address={mint}
                          symbol={item.tokenSymbol}
                          network={network}
                          variant="compact"
                        />
                      </div>
                    ) : null;
                  })()}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
