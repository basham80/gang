import {
  ArrowRight,
  BellPlus,
  Brain,
  Check,
  Copy,
  ExternalLink,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  OnChainTokenInspection,
  PersonalizedBrief,
  RiskProfile,
  SentimentAnalysis,
  SolanaToken,
} from '../types/solana';
import {
  filterAndSortTokens,
  formatCompactUsd,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  getSolscanTokenUrl,
  getSolscanTxUrl,
  resolveTokenAddressBySymbol,
  shortenAddress,
  SOL_MINT_ADDRESS,
  type SolanaCluster,
  type TokenFilterTab,
  type TokenSortKey,
} from '../utils/solanaLogic';
import { isValidSolanaPublicKey } from '../utils/solanaRpc';
import { Sparkline } from './Sparkline';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface TokenGainerViewProps {
  tokens: SolanaToken[];
  network?: SolanaCluster;
  loading: boolean;
  liveFeedConnected: boolean;
  lastSyncedAt: string;
  selectedTokenAddress: string | null;
  onSelectToken: (address: string | null) => void;
  onRefresh: () => void;
  onQuickTrade: (symbol: string) => void;
  onQuickAlert: (symbol: string) => void;
  onQuickBoost: (address: string) => void;
}

export function TokenGainerView({
  tokens,
  network = 'Mainnet-Beta',
  loading,
  liveFeedConnected,
  lastSyncedAt,
  selectedTokenAddress,
  onSelectToken,
  onRefresh,
  onQuickTrade,
  onQuickAlert,
  onQuickBoost,
}: TokenGainerViewProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TokenFilterTab>('all');
  const [sortBy, setSortBy] = useState<TokenSortKey>('change24h');
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Balanced');

  // Direct on-chain mint lookup
  const [mintLookupInput, setMintLookupInput] = useState('');
  const [mintLookupError, setMintLookupError] = useState<string | null>(null);
  const [customInspectedToken, setCustomInspectedToken] =
    useState<SolanaToken | null>(null);
  const [inspection, setInspection] = useState<OnChainTokenInspection | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);

  // Sentiment analysis cache per token+profile
  const [sentimentMap, setSentimentMap] = useState<Record<string, SentimentAnalysis>>({});
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentError, setSentimentError] = useState<string | null>(null);

  // Personalized AI market brief
  const [brief, setBrief] = useState<PersonalizedBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const visibleTokens = useMemo(
    () => filterAndSortTokens(tokens, { search, tab, sortBy }),
    [tokens, search, tab, sortBy]
  );

  const selectedToken = useMemo(() => {
    if (
      customInspectedToken &&
      (!selectedTokenAddress || customInspectedToken.address === selectedTokenAddress)
    ) {
      return customInspectedToken;
    }
    if (!selectedTokenAddress) return tokens[0] ?? null;
    return tokens.find((t) => t.address === selectedTokenAddress) ?? tokens[0] ?? null;
  }, [tokens, selectedTokenAddress, customInspectedToken]);

  // Live on-chain RPC + DEX pools inspection whenever selectedToken changes
  useEffect(() => {
    const targetAddr = selectedToken?.address;
    if (!targetAddr || !isValidSolanaPublicKey(targetAddr)) {
      setInspection(null);
      return;
    }
    const targetCluster = selectedToken?.cluster ?? network;
    let cancelled = false;
    setInspectionLoading(true);
    fetch(
      `/api/solana/token/${encodeURIComponent(targetAddr)}?network=${encodeURIComponent(targetCluster)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { inspection?: OnChainTokenInspection } | null) => {
        if (!cancelled && data?.inspection) {
          setInspection(data.inspection);
        }
      })
      .catch(() => {
        if (!cancelled) setInspection(null);
      })
      .finally(() => {
        if (!cancelled) setInspectionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedToken?.address, selectedToken?.cluster, network]);

  const kpis = useMemo(() => {
    const totalVolume = tokens.reduce((acc, t) => acc + t.volume24h, 0);
    const totalLiquidity = tokens.reduce((acc, t) => acc + t.liquidityUsd, 0);
    const verifiedCount = tokens.filter(
      (t) => t.security.mintRevoked && t.security.freezeRevoked
    ).length;
    const topGainer = [...tokens]
      .filter((t) => t.priceUsd > 0)
      .sort((a, b) => b.change24h - a.change24h)[0];
    return { totalVolume, totalLiquidity, verifiedCount, topGainer };
  }, [tokens]);

  const sentimentCacheKey = selectedToken
    ? `${selectedToken.address}:${riskProfile}`
    : '';
  const currentSentiment = sentimentCacheKey ? sentimentMap[sentimentCacheKey] : undefined;

  const handleMintLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMintLookupError(null);
    const addr = mintLookupInput.trim();
    if (!isValidSolanaPublicKey(addr)) {
      setMintLookupError('Enter a valid Solana SPL token mint address (Base58).');
      return;
    }
    setInspectionLoading(true);
    try {
      const res = await fetch(
        `/api/solana/token/${encodeURIComponent(addr)}?network=${encodeURIComponent(network)}`
      );
      const data = (await res.json()) as {
        inspection?: OnChainTokenInspection;
        token?: SolanaToken | null;
        error?: string;
      };
      if (!res.ok || !data.inspection) {
        throw new Error(data.error || 'Token lookup failed.');
      }
      if (!data.inspection.existsOnChain) {
        throw new Error(`No SPL mint account exists at ${addr} on Solana ${network}.`);
      }

      setInspection(data.inspection);
      const foundExisting = tokens.find((t) => t.address === addr);
      if (foundExisting) {
        setCustomInspectedToken(null);
        onSelectToken(foundExisting.address);
      } else {
        const syntheticFromOnChain: SolanaToken = data.token ?? {
          address: addr,
          symbol: data.inspection.symbol || shortenAddress(addr),
          name: data.inspection.name || `SPL Mint ${shortenAddress(addr)}`,
          category: 'DeFi',
          priceUsd: data.inspection.priceUsd,
          change5m: 0,
          change1h: 0,
          change24h: 0,
          volume24h: data.inspection.volume24hUsd,
          liquidityUsd: data.inspection.totalLiquidityUsd,
          marketCap: data.inspection.marketCapUsd,
          holders: data.inspection.topHolders.length,
          ageHours: 0.1,
          boostMultiplier: 1,
          boostTier: 'none',
          verifiedDev: data.inspection.mintRevoked && data.inspection.freezeRevoked,
          security: {
            mintRevoked: data.inspection.mintRevoked,
            freezeRevoked: data.inspection.freezeRevoked,
            lpLockedMonths: 0,
            metadataImmutable:
              data.inspection.mintRevoked && data.inspection.freezeRevoked,
          },
          sparkline: [data.inspection.priceUsd, data.inspection.priceUsd],
          description: `Verified on-chain SPL Mint on Solana ${network} (${data.inspection.supplyUi.toLocaleString('en-US')} supply, ${data.inspection.decimals} decimals).`,
          decimals: data.inspection.decimals,
          totalSupply: data.inspection.supplyUi,
          dexSource: data.inspection.pools[0]?.dexLabel ?? `Solana ${network} SPL`,
          pairAddress: data.inspection.pools[0]?.pairAddress,
          dexUrl: data.inspection.pools[0]?.dexUrl,
          onChainVerified: true,
          cluster: network,
        };
        setCustomInspectedToken(syntheticFromOnChain);
        onSelectToken(addr);
      }
      setMintLookupInput('');
    } catch (err) {
      setMintLookupError(
        err instanceof Error ? err.message : 'On-chain mint inspection failed.'
      );
    } finally {
      setInspectionLoading(false);
    }
  };

  const handleRunSentiment = async () => {
    if (!selectedToken) return;
    setSentimentLoading(true);
    setSentimentError(null);
    try {
      const res = await fetch('/api/ai/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: selectedToken.address,
          riskProfile,
          tokenSnapshot: selectedToken,
        }),
      });
      const data = (await res.json()) as {
        analysis?: SentimentAnalysis;
        error?: string;
      };
      if (!res.ok || !data.analysis) {
        throw new Error(data.error || 'Could not complete sentiment analysis.');
      }
      setSentimentMap((prev) => ({
        ...prev,
        [`${selectedToken.address}:${riskProfile}`]: data.analysis!,
      }));
    } catch (err) {
      setSentimentError(
        err instanceof Error ? err.message : 'Sentiment analysis request failed.'
      );
    } finally {
      setSentimentLoading(false);
    }
  };

  const handleGenerateBrief = async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riskProfile,
          extraTokens: tokens.slice(0, 10),
        }),
      });
      const data = (await res.json()) as {
        brief?: PersonalizedBrief;
        error?: string;
      };
      if (!res.ok || !data.brief) {
        throw new Error(data.error || 'Could not generate personalized brief.');
      }
      setBrief(data.brief);
    } catch (err) {
      setBriefError(
        err instanceof Error ? err.message : 'Personalized brief request failed.'
      );
    } finally {
      setBriefLoading(false);
    }
  };

  const handleCopyContract = (address: string) => {
    navigator.clipboard?.writeText(address);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  };

  const filterTabs: Array<{ id: TokenFilterTab; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'gainers', label: 'Gainers' },
    { id: 'boosted', label: 'Boosted' },
    { id: 'new_pairs', label: 'New' },
    { id: 'verified', label: 'Verified' },
  ];

  const activeCluster = selectedToken?.cluster ?? network;

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50">
            Solana Token Gainer
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            100% live Solana DEX markets, real RPC mint authority verification, liquidity pool inspector, and AI sentiment analysis.
          </p>
        </div>

        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center p-1 rounded-lg bg-[#0F1624] border border-slate-800 shrink-0">
            {(['Conservative', 'Balanced', 'Aggressive'] as RiskProfile[]).map(
              (profile) => (
                <button
                  key={profile}
                  type="button"
                  onClick={() => setRiskProfile(profile)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    riskProfile === profile
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {profile}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerateBrief}
            disabled={briefLoading || tokens.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{briefLoading ? 'Generating...' : 'AI Market Brief'}</span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh live Solana token prices"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-slate-100 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-800/80 rounded-xl bg-[#0F1624] divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80 overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="text-xs text-slate-400">24h Live DEX Volume</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-slate-50 tabular-nums">
            {formatCompactUsd(kpis.totalVolume)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {liveFeedConnected ? 'DexScreener + Solana RPC' : 'Syncing live pools'}
            {' · '}
            {formatRelativeTime(lastSyncedAt)}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs text-slate-400">Live Pool Liquidity</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-slate-50 tabular-nums">
            {formatCompactUsd(kpis.totalLiquidity)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Across {tokens.length} live Solana mints
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs text-slate-400">Top 24h Gainer</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-display text-xl font-bold text-slate-50">
              {kpis.topGainer?.symbol ?? '—'}
            </span>
            {kpis.topGainer && (
              <span
                className={`font-mono text-sm font-semibold tabular-nums ${
                  kpis.topGainer.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatPercent(kpis.topGainer.change24h)}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 truncate">
            {kpis.topGainer
              ? `${kpis.topGainer.name} · ${formatUsd(kpis.topGainer.priceUsd)}`
              : 'Loading live market feed'}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs text-slate-400">Authorities Revoked</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
            {kpis.verifiedCount} / {tokens.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Verified via Solana getMultipleAccounts
          </div>
        </div>
      </div>

      {/* Direct On-Chain SPL Mint Lookup Bar */}
      <form
        onSubmit={handleMintLookupSubmit}
        className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={mintLookupInput}
            onChange={(e) => setMintLookupInput(e.target.value)}
            placeholder={`Paste any Solana ${network} SPL Mint Address to inspect live RPC authorities, holders & Raydium/Meteora pools...`}
            aria-label="Inspect any Solana mint address on-chain"
            className="w-full px-3.5 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
          />
          {mintLookupError && (
            <p role="alert" className="mt-1.5 text-xs text-red-400">
              {mintLookupError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={inspectionLoading}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-300 transition-colors whitespace-nowrap shrink-0"
        >
          {inspectionLoading ? 'Querying RPC...' : 'Inspect On-Chain Mint'}
        </button>
      </form>

      {/* Personalized AI Brief Panel */}
      {(brief || briefError) && (
        <section
          aria-label="Personalized AI Market Brief"
          className="rounded-xl bg-[#0F1624] border border-slate-800 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
                <Brain className="w-4 h-4" />
                <span>Personalized AI Insights</span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="text-slate-400">{riskProfile} Profile</span>
              </div>
              {brief && (
                <h2 className="mt-1.5 font-display text-lg font-semibold text-slate-100">
                  {brief.headline}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setBrief(null);
                setBriefError(null);
              }}
              aria-label="Dismiss AI market brief"
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {briefError ? (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
            >
              {briefError}
            </div>
          ) : (
            brief && (
              <>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {brief.marketPulse}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  {brief.topPicks.map((pick) => {
                    const matched = tokens.find(
                      (t) => t.symbol.toUpperCase() === pick.symbol.toUpperCase()
                    );
                    const pickAddress =
                      matched?.address ?? resolveTokenAddressBySymbol(pick.symbol, tokens);
                    return (
                      <div
                        key={pick.symbol}
                        className="p-4 rounded-lg bg-[#090D16] border border-slate-800/80 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-semibold text-slate-100">
                            {pick.symbol}
                          </span>
                          <span className="text-xs font-medium text-emerald-400">
                            {pick.conviction} conviction
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {pick.thesis}
                        </p>
                        {pickAddress && (
                          <TokenExplorerLinks
                            address={pickAddress}
                            symbol={pick.symbol}
                            pairAddress={matched?.pairAddress}
                            dexUrl={matched?.dexUrl}
                            network={network}
                            variant="compact"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
                  <span>{brief.riskAdvisory}</span>
                  <span className="font-mono text-slate-500 shrink-0">
                    {brief.modelUsed} · {formatRelativeTime(brief.generatedAt)}
                  </span>
                </div>
              </>
            )
          )}
        </section>
      )}

      {/* Main Split Workspace: Live Token Table + Live On-Chain Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Token Gainer Data Table */}
        <div className="xl:col-span-8 rounded-xl bg-[#0F1624] border border-slate-800/80 overflow-hidden">
          <div className="p-4 border-b border-slate-800/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Filter Solana tokens"
                className="flex items-center gap-1 p-1 rounded-lg bg-[#090D16] border border-slate-800/80 overflow-x-auto max-w-full"
              >
                {filterTabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => setTab(item.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      tab === item.id
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="relative flex-1 sm:w-44">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter symbol or mint..."
                    aria-label="Search Solana tokens"
                    className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-[#090D16] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>

                <label className="sr-only" htmlFor="token-sort-select">
                  Sort tokens by
                </label>
                <select
                  id="token-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as TokenSortKey)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#090D16] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60 shrink-0"
                >
                  <option value="change24h">Sort: 24h</option>
                  <option value="change1h">Sort: 1h</option>
                  <option value="volume24h">Sort: Volume</option>
                  <option value="liquidityUsd">Sort: Liquidity</option>
                  <option value="marketCap">Sort: Market Cap</option>
                </select>
              </div>
            </div>
          </div>

          {loading && tokens.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin mx-auto" />
              <p className="text-sm font-medium text-slate-200">
                Fetching live Solana Mainnet-Beta markets from DexScreener & Solana RPC...
              </p>
            </div>
          ) : visibleTokens.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-200">
                No live Solana tokens match your current filter.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setTab('all');
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs font-medium text-slate-400">
                    <th className="py-3 pl-4 pr-2">Token</th>
                    <th className="py-3 px-2.5 text-right">Price</th>
                    <th className="py-3 px-2.5 text-right hidden sm:table-cell">1h</th>
                    <th className="py-3 px-2.5 text-right">24h</th>
                    <th className="py-3 px-2.5 text-right hidden md:table-cell">Volume</th>
                    <th className="py-3 px-2.5 text-right hidden lg:table-cell">Trend</th>
                    <th className="py-3 pl-2.5 pr-4 text-right">Liquidity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {visibleTokens.map((token) => {
                    const isSelected = selectedToken?.address === token.address;
                    return (
                      <tr
                        key={token.address}
                        className={`transition-colors ${
                          isSelected ? 'bg-slate-800/70' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2">
                          <div className="space-y-1">
                            <button
                              type="button"
                              onClick={() => {
                                setCustomInspectedToken(null);
                                onSelectToken(token.address);
                                setSentimentError(null);
                              }}
                              className="text-left focus-visible:outline-none focus-visible:underline group"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-display font-semibold text-slate-100 group-hover:text-emerald-400 transition-colors">
                                  {token.symbol}
                                </span>
                                {token.launchedByUser && (
                                  <span className="text-[11px] font-medium text-emerald-400 whitespace-nowrap">
                                    On-Chain Launch
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                <span className="truncate max-w-[115px]">{token.name}</span>
                                <span aria-hidden="true">·</span>
                                <span>{token.dexSource || 'Solana'}</span>
                              </div>
                            </button>
                            <TokenExplorerLinks
                              address={token.address}
                              symbol={token.symbol}
                              pairAddress={token.pairAddress}
                              dexUrl={token.dexUrl}
                              network={token.cluster ?? network}
                              variant="compact"
                            />
                          </div>
                        </td>

                        <td className="py-3 px-2.5 text-right font-mono text-xs sm:text-sm tabular-nums text-slate-100 whitespace-nowrap">
                          {token.priceUsd > 0 ? formatUsd(token.priceUsd) : 'No Pool Yet'}
                        </td>

                        <td
                          className={`py-3 px-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden sm:table-cell whitespace-nowrap ${
                            token.change1h >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {token.priceUsd > 0 ? formatPercent(token.change1h) : '—'}
                        </td>

                        <td
                          className={`py-3 px-2.5 text-right font-mono text-xs sm:text-sm tabular-nums font-medium whitespace-nowrap ${
                            token.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {token.priceUsd > 0 ? formatPercent(token.change24h) : '—'}
                        </td>

                        <td className="py-3 px-2.5 text-right font-mono text-xs sm:text-sm tabular-nums text-slate-300 hidden md:table-cell whitespace-nowrap">
                          {formatCompactUsd(token.volume24h)}
                        </td>

                        <td className="py-3 px-2.5 hidden lg:table-cell">
                          <div className="flex justify-end">
                            <Sparkline
                              data={token.sparkline}
                              positive={token.change24h >= 0}
                              width={68}
                              height={24}
                            />
                          </div>
                        </td>

                        <td className="py-3 pl-2.5 pr-4 text-right font-mono text-xs sm:text-sm tabular-nums text-slate-300 whitespace-nowrap">
                          {formatCompactUsd(token.liquidityUsd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Panel: Selected Token On-Chain Inspector & Live Pools */}
        <aside
          aria-label="Selected Token Inspector"
          className="xl:col-span-4 rounded-xl bg-[#0F1624] border border-slate-800/80 p-5 space-y-5"
        >
          {selectedToken ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-xl font-bold text-slate-50 truncate">
                      {selectedToken.name}
                    </h2>
                    <span className="font-mono text-sm text-slate-400 shrink-0">
                      {selectedToken.symbol}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>{selectedToken.dexSource || 'Solana DEX'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeCluster}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono text-lg font-semibold text-slate-50 tabular-nums">
                    {selectedToken.priceUsd > 0
                      ? formatUsd(selectedToken.priceUsd)
                      : 'Pre-Pool'}
                  </div>
                  {selectedToken.priceUsd > 0 && (
                    <div
                      className={`font-mono text-xs font-medium tabular-nums ${
                        selectedToken.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {formatPercent(selectedToken.change24h)} (24h)
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                {selectedToken.description}
              </p>

              {/* Mint Address & Operational Links */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-[#090D16] border border-slate-800/80">
                  <span className="text-slate-500">On-Chain Mint</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={getSolscanTokenUrl(selectedToken.address, activeCluster)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${selectedToken.symbol} mint on Solscan`}
                      className="inline-flex items-center gap-1 font-mono text-slate-300 hover:text-emerald-400 transition-colors"
                    >
                      <code>{shortenAddress(selectedToken.address)}</code>
                      <ExternalLink className="w-3 h-3 opacity-70" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopyContract(selectedToken.address)}
                      aria-label={`Copy ${selectedToken.symbol} mint address`}
                      className="text-slate-400 hover:text-emerald-400"
                    >
                      {copiedAddr ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {selectedToken.txSignature && (
                  <div className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-emerald-500/5 border border-emerald-500/25">
                    <span className="text-emerald-300">Mint Tx</span>
                    <a
                      href={getSolscanTxUrl(selectedToken.txSignature, activeCluster)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:text-emerald-200"
                    >
                      <code>{shortenAddress(selectedToken.txSignature)}</code>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                <TokenExplorerLinks
                  address={selectedToken.address}
                  symbol={selectedToken.symbol}
                  pairAddress={selectedToken.pairAddress ?? inspection?.pools[0]?.pairAddress}
                  dexUrl={selectedToken.dexUrl ?? inspection?.pools[0]?.dexUrl}
                  network={activeCluster}
                  variant="buttons"
                  showPools
                  showMeteora
                />

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-[#090D16] border border-slate-800/80">
                    <div className="text-slate-500">Market Cap</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                      {selectedToken.marketCap > 0
                        ? formatCompactUsd(selectedToken.marketCap)
                        : selectedToken.address === SOL_MINT_ADDRESS
                          ? 'Native L1'
                          : 'Unindexed'}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#090D16] border border-slate-800/80">
                    <div className="text-slate-500">24h On-Chain Txns</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                      {selectedToken.holders.toLocaleString('en-US')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live On-Chain RPC Security Audit */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Live On-Chain RPC Audit</span>
                  </span>
                  {inspectionLoading && (
                    <span className="text-[11px] text-slate-500">Querying RPC...</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Mint Authority</span>
                    <span
                      className={
                        (inspection?.mintRevoked ?? selectedToken.security.mintRevoked)
                          ? 'text-emerald-400 font-medium'
                          : 'text-amber-400 font-medium'
                      }
                    >
                      {(inspection?.mintRevoked ?? selectedToken.security.mintRevoked)
                        ? 'Revoked'
                        : 'Active'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Freeze Authority</span>
                    <span
                      className={
                        (inspection?.freezeRevoked ?? selectedToken.security.freezeRevoked)
                          ? 'text-emerald-400 font-medium'
                          : 'text-amber-400 font-medium'
                      }
                    >
                      {(inspection?.freezeRevoked ?? selectedToken.security.freezeRevoked)
                        ? 'Revoked'
                        : 'Active'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Decimals</span>
                    <span className="font-mono text-slate-200 tabular-nums">
                      {inspection?.decimals ?? selectedToken.decimals ?? 9}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>On-Chain Supply</span>
                    <span className="font-mono text-slate-200 tabular-nums truncate max-w-[95px]">
                      {selectedToken.address === SOL_MINT_ADDRESS &&
                      (inspection?.supplyUi ?? selectedToken.totalSupply ?? 0) === 0
                        ? 'Native SOL'
                        : (inspection?.supplyUi ?? selectedToken.totalSupply ?? 0).toLocaleString(
                            'en-US',
                            { maximumFractionDigits: 0 }
                          )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Live Active DEX Liquidity Pools (Operational Pool Pair Links) */}
              {inspection && inspection.pools.length > 0 && (
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Active DEX Liquidity Pools ({inspection.pools.length})</span>
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {inspection.pools.slice(0, 5).map((pool) => (
                      <div
                        key={pool.pairAddress}
                        className="p-2.5 rounded-lg bg-[#090D16] border border-slate-800/80 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-200">
                            {pool.dexLabel} · {pool.baseSymbol}/{pool.quoteSymbol}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            Liq {formatCompactUsd(pool.liquidityUsd)} · Vol{' '}
                            {formatCompactUsd(pool.volume24h)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[11px]">
                          <a
                            href={pool.dexUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-0.5"
                          >
                            <span>Chart</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                          <a
                            href={getSolscanTokenUrl(pool.pairAddress, activeCluster)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-slate-200 inline-flex items-center gap-0.5"
                          >
                            <span>Pool</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Action Bar */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onQuickTrade(selectedToken.symbol)}
                  className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <span>Swap</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onQuickAlert(selectedToken.symbol)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <BellPlus className="w-3.5 h-3.5" />
                  <span>Alert</span>
                </button>
                <button
                  type="button"
                  onClick={() => onQuickBoost(selectedToken.address)}
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:border-amber-500/60 text-amber-300 font-medium text-xs transition-colors whitespace-nowrap"
                >
                  Boost
                </button>
              </div>

              {/* AI-Driven Sentiment Analysis */}
              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      AI Sentiment Analysis
                    </h3>
                    <p className="text-xs text-slate-500">
                      Grounded in live {selectedToken.symbol} on-chain metrics
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRunSentiment}
                    disabled={sentimentLoading}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-emerald-400 transition-colors whitespace-nowrap"
                  >
                    {sentimentLoading
                      ? 'Analyzing...'
                      : currentSentiment
                        ? 'Re-Analyze'
                        : 'Analyze Sentiment'}
                  </button>
                </div>

                {sentimentError && (
                  <div
                    role="alert"
                    className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed"
                  >
                    {sentimentError}
                  </div>
                )}

                {currentSentiment ? (
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#090D16] border border-slate-800/80">
                      <span
                        className={`font-semibold ${
                          currentSentiment.polarity === 'Bullish'
                            ? 'text-emerald-400'
                            : currentSentiment.polarity === 'Bearish'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {currentSentiment.polarity} Sentiment
                      </span>
                      <span className="font-mono text-slate-300 tabular-nums">
                        {Math.round(currentSentiment.confidence)}% confidence
                      </span>
                    </div>

                    <p className="text-slate-300 leading-relaxed">
                      {currentSentiment.summary}
                    </p>

                    <div className="space-y-1.5">
                      <div className="font-medium text-slate-200">Key Catalysts</div>
                      <ul className="space-y-1 text-slate-400 list-disc pl-4">
                        {currentSentiment.catalysts.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-1.5">
                      <div className="font-medium text-slate-200">Risk Factors</div>
                      <ul className="space-y-1 text-slate-400 list-disc pl-4">
                        {currentSentiment.risks.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 rounded-lg bg-[#090D16] border border-slate-800/80 space-y-1">
                      <div className="font-medium text-emerald-400">
                        {riskProfile} Strategy Note
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        {currentSentiment.personalizedTake}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Run live Gemini sentiment analysis to evaluate {selectedToken.symbol}'s live liquidity, momentum, and on-chain authority posture.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">
              Select a live Solana token or paste any SPL mint address above to inspect real on-chain pools and authorities.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
