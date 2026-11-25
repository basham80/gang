import {
  ArrowRight,
  BadgeCheck,
  Copy,
  ExternalLink,
  Plus,
  Search,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  SolanaCluster,
  SolanaToken,
  TrendingCoin,
  XTrackerSignal,
} from '../types/solana';
import {
  formatRelativeTime,
  resolveTokenAddressBySymbol,
} from '../utils/solanaLogic';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface XTrackerViewProps {
  signals: XTrackerSignal[];
  tokens: SolanaToken[];
  network?: SolanaCluster;
  onCopyToLaunchpad: (coin: TrendingCoin) => void;
  onInspectTokenBySymbol: (symbol: string) => void;
  onQuickTrade: (symbol: string) => void;
  onAddSignalWatch: (handle: string, cashtag: string) => void;
}

export function XTrackerView({
  signals,
  tokens,
  network = 'Mainnet-Beta',
  onCopyToLaunchpad,
  onInspectTokenBySymbol,
  onQuickTrade,
  onAddSignalWatch,
}: XTrackerViewProps) {
  const [search, setSearch] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState<
    'All' | XTrackerSignal['sentiment']
  >('All');
  const [watchHandle, setWatchHandle] = useState('');
  const [watchCashtag, setWatchCashtag] = useState('');
  const [watchError, setWatchError] = useState<string | null>(null);

  const filteredSignals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return signals.filter((s) => {
      if (sentimentFilter !== 'All' && s.sentiment !== sentimentFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.cashtag.toLowerCase().includes(q) ||
        s.handle.toLowerCase().includes(q) ||
        s.tokenName.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q)
      );
    });
  }, [signals, search, sentimentFilter]);

  const handleAddWatch = (e: React.FormEvent) => {
    e.preventDefault();
    setWatchError(null);
    const cleanHandle = watchHandle.trim().replace(/^@/, '');
    const cleanTag = watchCashtag.trim().replace(/^\$/, '').toUpperCase();

    if (cleanHandle.length < 2) {
      setWatchError('Enter an X handle to monitor (e.g. solana).');
      return;
    }
    if (cleanTag.length < 2 || cleanTag.length > 10) {
      setWatchError('Enter a 2–10 letter cashtag to track (e.g. BONK).');
      return;
    }

    onAddSignalWatch(`@${cleanHandle}`, cleanTag);
    setWatchHandle('');
    setWatchCashtag('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50">
            Live X & Solana Token Feed
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Verified official X accounts linked directly from active Solana DEX pools, paired with real 1-hour on-chain buy/sell velocity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center p-1 rounded-lg bg-[#0F1624] border border-slate-800">
            {(['All', 'Bullish', 'Alert', 'Neutral'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSentimentFilter(opt)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  sentimentFilter === opt
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>

          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter @handle or $SOL"
              aria-label="Filter X tracker signals"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#0F1624] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
          </div>
        </div>
      </div>

      {/* Add Watched Handle / Cashtag Bar */}
      <form
        onSubmit={handleAddWatch}
        noValidate
        className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-4 sm:p-5 space-y-3"
      >
        <div className="text-xs font-medium text-slate-300">
          Pin Custom X Handle & Solana Cashtag Watch
        </div>
        {watchError && (
          <p role="alert" className="text-xs text-red-400">
            {watchError}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            value={watchHandle}
            onChange={(e) => setWatchHandle(e.target.value)}
            placeholder="@handle (e.g. solana)"
            aria-label="X handle to track"
            className="px-3.5 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
          />
          <input
            type="text"
            value={watchCashtag}
            onChange={(e) => setWatchCashtag(e.target.value.toUpperCase())}
            placeholder="$CASHTAG (e.g. WIF)"
            aria-label="Solana cashtag to track"
            className="px-3.5 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Watch</span>
          </button>
        </div>
      </form>

      {/* Signals Feed */}
      <div className="rounded-xl bg-[#0F1624] border border-slate-800/80 divide-y divide-slate-800/70">
        {filteredSignals.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Loading verified X links from live Solana DEX pairs...
          </div>
        ) : (
          filteredSignals.map((sig) => {
            const xProfileUrl =
              sig.xUrl ||
              sig.twitterUrl ||
              `https://x.com/${encodeURIComponent(sig.handle.replace(/^@/, ''))}`;
            const mint =
              sig.tokenAddress || resolveTokenAddressBySymbol(sig.cashtag, tokens);
            const matchedLiveToken = tokens.find(
              (t) =>
                (mint && t.address === mint) ||
                t.symbol.toUpperCase() === sig.cashtag.toUpperCase()
            );

            return (
              <article
                key={sig.id}
                className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-start justify-between gap-4"
              >
                <div className="space-y-2.5 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <a
                      href={xProfileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-slate-100 hover:text-emerald-400 inline-flex items-center gap-1 transition-colors"
                    >
                      <span>{sig.displayName}</span>
                      {sig.verified && (
                        <BadgeCheck
                          className="w-3.5 h-3.5 text-emerald-400"
                          aria-label="Verified token X account"
                        />
                      )}
                      <ExternalLink className="w-3 h-3 opacity-70" />
                    </a>
                    <span className="font-mono text-slate-500">{sig.handle}</span>
                    <span aria-hidden="true">·</span>
                    <span>{sig.followersLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        sig.sentiment === 'Bullish'
                          ? 'text-emerald-400'
                          : sig.sentiment === 'Alert'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                      }`}
                    >
                      {sig.sentiment}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTime(sig.postedAt)}</span>
                  </div>

                  <p className="text-sm text-slate-200 leading-relaxed">
                    {sig.content}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-mono tabular-nums pt-0.5">
                    <span className="text-emerald-400 font-semibold">
                      ${sig.cashtag}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      {sig.mentionsVelocity}
                    </span>
                    <span className="inline-flex items-center gap-1 text-emerald-400/90">
                      <TrendingUp className="w-3.5 h-3.5" />
                      {sig.likes.toLocaleString('en-US')} buys/1h
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <TrendingDown className="w-3.5 h-3.5" />
                      {sig.reposts.toLocaleString('en-US')} sells/1h
                    </span>
                  </div>

                  {mint && (
                    <TokenExplorerLinks
                      address={mint}
                      symbol={sig.cashtag}
                      pairAddress={sig.pairAddress ?? matchedLiveToken?.pairAddress}
                      network={network}
                      variant="compact"
                      showPools
                    />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onCopyToLaunchpad({
                        id: `clone-${sig.id}`,
                        address: mint || '',
                        pairAddress: sig.pairAddress,
                        name: sig.tokenName,
                        symbol: sig.cashtag,
                        description: matchedLiveToken?.description || sig.content.slice(0, 180),
                        holders: matchedLiveToken?.holders ?? sig.likes + sig.reposts,
                        marketCapUsd: matchedLiveToken?.marketCap ?? 0,
                        liquidityUsd: matchedLiveToken?.liquidityUsd ?? 0,
                        volume24hUsd: matchedLiveToken?.volume24h ?? 0,
                        priceUsd: matchedLiveToken?.priceUsd ?? 0,
                        change24h: matchedLiveToken?.change24h ?? 0,
                        buysPerHour: sig.likes,
                        sellsPerHour: sig.reposts,
                        lastBuyLabel: `${sig.likes} buys/1h`,
                        platform: 'Raydium',
                        isNew: true,
                        accentColor: '#10B981',
                        decimals: matchedLiveToken?.decimals ?? 9,
                        totalSupply: 1000000000,
                        category: matchedLiveToken?.category ?? 'Meme',
                        socials: { twitter: xProfileUrl },
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <Copy className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Clone Spec</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspectTokenBySymbol(sig.cashtag)}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    Inspect
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickTrade(sig.cashtag)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    <span>Trade</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
