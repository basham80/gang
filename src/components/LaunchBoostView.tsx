import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Droplets,
  ExternalLink,
  Flame,
  ImagePlus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { launchRealSplTokenOnChain } from '../services/solanaOnChain';
import type {
  Announcement,
  LaunchFormInput,
  LaunchPlatform,
  SolanaToken,
  TrendingCoin,
  WalletState,
} from '../types/solana';
import {
  BASE_DEPLOY_FEE_SOL,
  formatCompactUsd,
  formatPercent,
  getDexScreenerTokenUrl,
  getMeteoraCreatePoolUrl,
  getRaydiumCreatePoolUrl,
  getSolscanTokenUrl,
  getSolscanTxUrl,
  shortenAddress,
  validateLaunchForm,
} from '../utils/solanaLogic';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface LaunchBoostViewProps {
  tokens: SolanaToken[];
  wallet: WalletState;
  preselectedBoostAddress: string | null;
  clonedTrendingCoin: TrendingCoin | null;
  onClearClonedCoin: () => void;
  onRequireWallet: () => void;
  onTokenLaunched: (
    token: SolanaToken,
    announcement: Announcement,
    solSpent: number,
    txSignature: string
  ) => void;
  onInspectLaunchedToken: (address: string) => void;
  onCreatePoolForToken: () => void;
}

const BANNER_SRC = '/src/assets/images/launchpad_studio_banner_1795503421682.jpg';

const DEFAULT_LAUNCH_FORM: LaunchFormInput = {
  name: '',
  symbol: '',
  category: 'Meme',
  description: '',
  decimals: 9,
  totalSupply: 1000000000,
  initialLpSol: 0,
  imageDataUrl: undefined,
  imageFileName: undefined,
  website: '',
  twitter: '',
  telegram: '',
  discord: '',
  modifyCreator: false,
  creatorName: '',
  creatorWebsite: '',
  mintRevoked: true,
  freezeRevoked: true,
  lpLockedMonths: 0,
  metadataImmutable: true,
  boostTier: 'none',
};

export function LaunchBoostView({
  tokens,
  wallet,
  preselectedBoostAddress,
  clonedTrendingCoin,
  onClearClonedCoin,
  onRequireWallet,
  onTokenLaunched,
  onInspectLaunchedToken,
  onCreatePoolForToken,
}: LaunchBoostViewProps) {
  const [studioTab, setStudioTab] = useState<'create' | 'copy' | 'boost'>(
    preselectedBoostAddress ? 'boost' : 'create'
  );

  // 3-Step Create Coin Wizard state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<LaunchFormInput>(DEFAULT_LAUNCH_FORM);
  const [stepError, setStepError] = useState<string | null>(null);
  const [clonedSourceLabel, setClonedSourceLabel] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchSuccess, setLaunchSuccess] = useState<SolanaToken | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live Copy Trending Coins state (100% real DexScreener boosted/latest Solana pairs)
  const [trendingTab, setTrendingTab] = useState<'trending' | 'new'>('trending');
  const [platformFilter, setPlatformFilter] = useState<'All' | LaunchPlatform>('All');
  const [trendingCoins, setTrendingCoins] = useState<TrendingCoin[]>([]);
  const [refreshingTrending, setRefreshingTrending] = useState(false);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  // Boost Portal target token
  const [boostTokenAddr, setBoostTokenAddr] = useState<string>(
    preselectedBoostAddress || tokens[0]?.address || ''
  );

  const loadLiveTrending = useCallback(async (force = false) => {
    setRefreshingTrending(true);
    setTrendingError(null);
    try {
      const res = await fetch(`/api/trending-clone${force ? '?force=1' : ''}`);
      const data = (await res.json()) as { coins?: TrendingCoin[] };
      if (!res.ok) throw new Error('Could not load live trending Solana pairs.');
      setTrendingCoins(Array.isArray(data.coins) ? data.coins : []);
    } catch (err) {
      setTrendingError(
        err instanceof Error ? err.message : 'Live trending feed unavailable.'
      );
    } finally {
      setRefreshingTrending(false);
    }
  }, []);

  useEffect(() => {
    void loadLiveTrending(false);
  }, [loadLiveTrending]);

  const applyClonedCoin = (coin: TrendingCoin) => {
    setForm({
      ...DEFAULT_LAUNCH_FORM,
      name: coin.name,
      symbol: coin.symbol,
      category: coin.category,
      description: coin.description,
      decimals: coin.decimals,
      totalSupply: coin.totalSupply,
      website: coin.socials?.website ?? '',
      twitter: coin.socials?.twitter ?? '',
      telegram: coin.socials?.telegram ?? '',
      discord: coin.socials?.discord ?? '',
    });
    setClonedSourceLabel(`${coin.name} ($${coin.symbol}) from ${coin.platform}`);
    setStudioTab('create');
    setStep(1);
    setStepError(null);
    setLaunchError(null);
    setLaunchSuccess(null);
  };

  useEffect(() => {
    if (clonedTrendingCoin) {
      applyClonedCoin(clonedTrendingCoin);
      onClearClonedCoin();
    }
  }, [clonedTrendingCoin, onClearClonedCoin]);

  const solPrice = tokens.find((t) => t.symbol === 'SOL')?.priceUsd ?? 150;
  const preview = useMemo(
    () => validateLaunchForm(form, solPrice),
    [form, solPrice]
  );

  const visibleTrending = useMemo(() => {
    return trendingCoins.filter((c) => {
      if (trendingTab === 'new' && !c.isNew) return false;
      if (platformFilter !== 'All' && c.platform !== platformFilter) return false;
      return true;
    });
  }, [trendingCoins, trendingTab, platformFilter]);

  const handleImageFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStepError('Upload a PNG, JPG, GIF, or WebP image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = typeof reader.result === 'string' ? reader.result : undefined;
      if (!rawUrl) return;
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 160;
          const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const compact = canvas.toDataURL('image/jpeg', 0.82);
            setForm((prev) => ({
              ...prev,
              imageDataUrl: compact.length <= 65000 ? compact : rawUrl.slice(0, 65000),
              imageFileName: file.name,
            }));
          }
        } catch {
          setForm((prev) => ({
            ...prev,
            imageDataUrl: rawUrl.length <= 65000 ? rawUrl : undefined,
            imageFileName: file.name,
          }));
        }
        setStepError(null);
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleNextStep = () => {
    setStepError(null);
    if (step === 1) {
      if (preview.errors.name || preview.errors.symbol) {
        setStepError(preview.errors.name || preview.errors.symbol);
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (
        preview.errors.decimals ||
        preview.errors.totalSupply ||
        preview.errors.description
      ) {
        setStepError(
          preview.errors.decimals ||
            preview.errors.totalSupply ||
            preview.errors.description
        );
        return;
      }
      setStep(3);
    }
  };

  const handleLaunchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepError(null);
    setLaunchError(null);
    setLaunchSuccess(null);
    setLaunchStatus(null);

    if (!preview.valid) {
      const firstErr = Object.values(preview.errors)[0];
      setLaunchError(firstErr || 'Complete all required fields before deploying on-chain.');
      return;
    }

    if (!wallet.connected || !wallet.canSign) {
      setLaunchError(
        'Connect Phantom, Solflare, Backpack, or generate a Local Solana Keypair in Wallet to sign and broadcast a real on-chain SPL token transaction.'
      );
      onRequireWallet();
      return;
    }

    setLaunching(true);
    try {
      setLaunchStatus(
        `Step 1/2: Signing & broadcasting real SPL Token Mint transaction on Solana ${wallet.network}...`
      );
      const onChain = await launchRealSplTokenOnChain({
        network: wallet.network,
        provider: wallet.provider,
        payerAddress: wallet.address,
        decimals: form.decimals,
        totalSupply: form.totalSupply,
        mintRevoked: form.mintRevoked,
        freezeRevoked: form.freezeRevoked,
      });

      setLaunchStatus(
        `Step 2/2: Confirmed on-chain (${shortenAddress(onChain.signature)}). Verifying mint via Solana RPC...`
      );

      const res = await fetch('/api/tokens/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: onChain.mintAddress,
          txSignature: onChain.signature,
          cluster: onChain.cluster,
          symbol: preview.normalizedSymbol,
          name: form.name.trim(),
          category: form.category,
          description: form.description.trim(),
          decimals: form.decimals,
          totalSupply: form.totalSupply,
          imageUrl: form.imageDataUrl,
          socials: {
            website: form.website,
            twitter: form.twitter,
            telegram: form.telegram,
            discord: form.discord,
          },
          creatorName: form.modifyCreator ? form.creatorName : undefined,
          creatorWebsite: form.modifyCreator ? form.creatorWebsite : undefined,
          walletAddress: wallet.address,
          costSol: onChain.costSol,
        }),
      });

      const data = (await res.json()) as {
        token?: SolanaToken;
        announcement?: Announcement;
        error?: string;
      };
      if (!res.ok || !data.token || !data.announcement) {
        throw new Error(
          data.error ||
            `Mint ${onChain.mintAddress} confirmed on-chain (${onChain.signature}), but registration returned an error.`
        );
      }

      onTokenLaunched(data.token, data.announcement, onChain.costSol, onChain.signature);
      setLaunchSuccess(data.token);
      setForm(DEFAULT_LAUNCH_FORM);
      setClonedSourceLabel(null);
      setStep(1);
      setLaunchStatus(null);
    } catch (err) {
      setLaunchError(
        err instanceof Error ? err.message : 'On-chain SPL token deployment failed.'
      );
      setLaunchStatus(null);
    } finally {
      setLaunching(false);
    }
  };

  const selectedBoostToken =
    tokens.find((t) => t.address === boostTokenAddr) ?? tokens[0];

  return (
    <div className="space-y-6">
      {/* Architectural Hero Banner */}
      <section className="relative rounded-xl overflow-hidden border border-slate-800/80 bg-[#0F1624]">
        <div className="relative h-40 sm:h-44 w-full">
          <img
            src={BANNER_SRC}
            alt="Architectural basalt monoliths representing Solana launchpad infrastructure"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center opacity-70"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#090D16]/95 via-[#090D16]/80 to-[#090D16]/40" />
          <div className="absolute inset-0 p-6 sm:p-8 flex flex-col justify-end">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-emerald-400">
                Real On-Chain Solana SPL Minting · Live Trending Cloner · DexScreener & Raydium Ready
              </p>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-50 tracking-tight">
                Launch Your Own Coin On-Chain
              </h1>
              <p className="mt-1 text-sm text-slate-300 leading-relaxed">
                Every coin deployed here broadcasts a genuine Solana SPL Mint transaction so your Solscan, DexScreener, and Raydium links work immediately on-chain.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Studio Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Launch Pad studio modes"
          className="inline-flex flex-wrap p-1 rounded-lg bg-[#0F1624] border border-slate-800 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'create'}
            onClick={() => setStudioTab('create')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              studioTab === 'create'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Rocket className="w-4 h-4 text-emerald-400" />
            <span>Create SPL Coin</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'copy'}
            onClick={() => setStudioTab('copy')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              studioTab === 'copy'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4 text-emerald-400" />
            <span>Copy Live Trending</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'boost'}
            onClick={() => setStudioTab('boost')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              studioTab === 'boost'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-4 h-4 text-amber-400" />
            <span>DEX Listing & Boosts</span>
          </button>
        </div>

        {!wallet.connected || !wallet.canSign ? (
          <button
            type="button"
            onClick={onRequireWallet}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 self-start sm:self-auto"
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Connect signing wallet (Phantom / Local Keypair) to mint on-chain →</span>
          </button>
        ) : (
          <span className="text-xs font-mono text-slate-400">
            Deploying to <strong className="text-emerald-400">{wallet.network}</strong> ·{' '}
            {(wallet.balances.SOL ?? 0).toFixed(4)} SOL available
          </span>
        )}
      </div>

      {/* TAB 1: 3-STEP REAL ON-CHAIN SPL CREATOR */}
      {studioTab === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-5">
            {/* Stepper */}
            <div className="flex items-center justify-center gap-3 py-2">
              {(
                [
                  { num: 1, label: 'Identity & Image' },
                  { num: 2, label: 'Supply & Details' },
                  { num: 3, label: 'Authorities & Deploy' },
                ] as const
              ).map((item, idx) => {
                const isDone = step > item.num;
                const isCurrent = step === item.num;
                return (
                  <div key={item.num} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.num < step) {
                          setStep(item.num);
                          setStepError(null);
                        }
                      }}
                      className="flex items-center gap-2 text-left"
                    >
                      <span
                        className={`w-8 h-8 rounded-full font-mono text-sm font-semibold flex items-center justify-center transition-colors ${
                          isCurrent || isDone
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isDone ? <Check className="w-4 h-4" /> : item.num}
                      </span>
                      <span
                        className={`hidden sm:inline text-xs font-medium whitespace-nowrap ${
                          isCurrent ? 'text-slate-100' : 'text-slate-500'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                    {idx < 2 && (
                      <div
                        className={`w-10 sm:w-14 h-px ${
                          step > item.num ? 'bg-emerald-500' : 'bg-slate-800'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={handleLaunchSubmit}
              noValidate
              className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-6 space-y-6"
            >
              {clonedSourceLabel && (
                <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs text-emerald-200">
                  <span>
                    Loaded live specs from <strong className="text-emerald-100">{clonedSourceLabel}</strong>. Customize details and mint your own real SPL token on-chain.
                  </span>
                  <button
                    type="button"
                    onClick={() => setClonedSourceLabel(null)}
                    className="text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {launchStatus && (
                <div
                  role="status"
                  className="p-3.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200 flex items-center gap-2.5"
                >
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                  <span>{launchStatus}</span>
                </div>
              )}

              {(stepError || launchError) && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 leading-relaxed"
                >
                  {stepError || launchError}
                </div>
              )}

              {launchSuccess && (
                <div
                  role="status"
                  className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="text-sm text-emerald-100">
                        <span className="font-semibold">
                          {launchSuccess.name} (${launchSuccess.symbol})
                        </span>{' '}
                        confirmed on Solana {launchSuccess.cluster || wallet.network}! Supply minted directly to your wallet.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onInspectLaunchedToken(launchSuccess.address)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0"
                    >
                      Inspect Mint
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-emerald-500/20 text-xs font-mono">
                    <a
                      href={getSolscanTokenUrl(
                        launchSuccess.address,
                        launchSuccess.cluster ?? wallet.network
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100"
                    >
                      <span>Mint: {shortenAddress(launchSuccess.address)}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {launchSuccess.txSignature && (
                      <a
                        href={getSolscanTxUrl(
                          launchSuccess.txSignature,
                          launchSuccess.cluster ?? wallet.network
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100"
                      >
                        <span>Tx: {shortenAddress(launchSuccess.txSignature)}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Next Step: Seed Real Raydium / Meteora Pool so DexScreener indexes live price */}
                  <div className="pt-2 border-t border-emerald-500/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-emerald-200/90">
                      Next step for DexScreener & Raydium trading: open a live liquidity pool using your new mint address:
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={getRaydiumCreatePoolUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 font-semibold"
                      >
                        <Droplets className="w-3 h-3" />
                        <span>Open Raydium Create Pool</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={getMeteoraCreatePoolUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 hover:text-emerald-300 font-semibold"
                      >
                        <span>Open Meteora Pool</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        type="button"
                        onClick={onCreatePoolForToken}
                        className="px-2.5 py-1 rounded bg-slate-800 text-slate-200 hover:text-white font-medium"
                      >
                        Manage Liquidity →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 1 */}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="launch-name"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        Token Name
                      </label>
                      <input
                        id="launch-name"
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="e.g. GOKU or Yabbie Cash"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="launch-symbol"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        Token Symbol
                      </label>
                      <input
                        id="launch-symbol"
                        type="text"
                        value={form.symbol}
                        onChange={(e) =>
                          setForm({ ...form, symbol: e.target.value.toUpperCase() })
                        }
                        placeholder="e.g. GOKU"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                      />
                    </div>
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-slate-300 mb-1.5">
                      Token Image (Optional)
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      aria-label="Upload token image"
                      onChange={(e) => handleImageFile(e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragActive(false);
                        handleImageFile(e.dataTransfer.files?.[0]);
                      }}
                      className={`w-full rounded-xl border border-dashed py-8 px-6 flex flex-col items-center justify-center gap-3 transition-colors ${
                        dragActive
                          ? 'border-emerald-400 bg-emerald-500/10'
                          : 'border-slate-700 bg-[#090D16] hover:border-slate-600'
                      }`}
                    >
                      {form.imageDataUrl ? (
                        <>
                          <img
                            src={form.imageDataUrl}
                            alt="Uploaded token emblem preview"
                            className="w-16 h-16 rounded-full object-cover border border-slate-700"
                          />
                          <div className="text-sm font-medium text-slate-100">
                            {form.imageFileName || 'Token emblem ready'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-11 h-11 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                            <ImagePlus className="w-5 h-5" />
                          </div>
                          <div className="text-sm font-medium text-slate-200">
                            Click or drag token artwork here
                          </div>
                          <div className="text-xs text-slate-500">
                            PNG, JPG, GIF or WebP
                          </div>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
                    >
                      <span>Next</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2 */}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label
                          htmlFor="launch-decimals"
                          className="text-xs font-medium text-slate-300"
                        >
                          SPL Decimals
                        </label>
                        <div className="inline-flex gap-1 text-xs">
                          {[0, 6, 9].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setForm({ ...form, decimals: d })}
                              className={`px-2 py-0.5 rounded font-mono ${
                                form.decimals === d
                                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                                  : 'text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        id="launch-decimals"
                        type="number"
                        min={0}
                        max={9}
                        value={form.decimals}
                        onChange={(e) =>
                          setForm({ ...form, decimals: Number(e.target.value) })
                        }
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500/60"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        6 for DeFi / stable-style, 9 for standard Solana SPL tokens
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="launch-supply"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        Total Supply (Minted directly to your wallet)
                      </label>
                      <input
                        id="launch-supply"
                        type="number"
                        min={1000}
                        step={1000000}
                        value={form.totalSupply}
                        onChange={(e) =>
                          setForm({ ...form, totalSupply: Number(e.target.value) })
                        }
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500/60"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="launch-category"
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                    >
                      Category
                    </label>
                    <select
                      id="launch-category"
                      value={form.category}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          category: e.target.value as SolanaToken['category'],
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
                    >
                      <option value="Meme">Meme</option>
                      <option value="DeFi">DeFi</option>
                      <option value="AI">AI</option>
                      <option value="Infrastructure">Infrastructure</option>
                      <option value="Community">Community</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="launch-description"
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                    >
                      Description
                    </label>
                    <textarea
                      id="launch-description"
                      rows={4}
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      placeholder="Describe your Solana SPL token..."
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStep(1);
                        setStepError(null);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 text-sm font-medium transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Previous</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
                    >
                      <span>Next</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3 */}
              {step === 3 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="launch-website"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        Website
                      </label>
                      <input
                        id="launch-website"
                        type="url"
                        value={form.website ?? ''}
                        onChange={(e) => setForm({ ...form, website: e.target.value })}
                        placeholder="https://myproject.com"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="launch-twitter"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        Twitter (X)
                      </label>
                      <input
                        id="launch-twitter"
                        type="url"
                        value={form.twitter ?? ''}
                        onChange={(e) => setForm({ ...form, twitter: e.target.value })}
                        placeholder="https://x.com/myproject"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                      />
                    </div>
                  </div>

                  {/* Real On-Chain SPL Authority Revocations (0 platform fee — executed directly in the atomic SPL tx) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        {
                          key: 'freezeRevoked' as const,
                          title: 'Revoke Freeze Authority On-Chain',
                          desc: 'Sets freezeAuthority = null during InitializeMint2. Required by Raydium & Meteora pools.',
                        },
                        {
                          key: 'mintRevoked' as const,
                          title: 'Revoke Mint Authority On-Chain',
                          desc: 'Appends SetAuthority(MintTokens, null) in the same atomic tx so total supply is permanently fixed.',
                        },
                      ] as const
                    ).map((card) => {
                      const active = form[card.key];
                      return (
                        <div
                          key={card.key}
                          className={`p-4 rounded-xl border flex flex-col justify-between gap-4 transition-colors ${
                            active
                              ? 'bg-emerald-500/10 border-emerald-500/60'
                              : 'bg-[#090D16] border-slate-800'
                          }`}
                        >
                          <div className="space-y-1.5">
                            <div className="font-display text-sm font-semibold text-slate-100">
                              {card.title}
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              {card.desc}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="font-mono text-xs text-emerald-400">
                              0 SOL Platform Fee
                            </span>
                            <button
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setForm({ ...form, [card.key]: !active })
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {active ? 'Enabled' : 'Disabled'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStep(2);
                        setStepError(null);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 text-sm font-medium transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Previous</span>
                    </button>

                    <button
                      type="submit"
                      disabled={launching}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors"
                    >
                      <Rocket className="w-4 h-4" />
                      <span>
                        {launching
                          ? 'Confirming On-Chain...'
                          : `Deploy Real SPL Token (${wallet.network})`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Right Column: Live On-Chain Transaction Breakdown */}
          <aside className="lg:col-span-4 rounded-xl bg-[#0F1624] border border-slate-800/80 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-100">
                On-Chain Execution Summary
              </h2>
              <span className="font-mono text-xs text-emerald-400">
                {wallet.network}
              </span>
            </div>

            <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800/80 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Token</span>
                <span className="font-semibold text-slate-100">
                  {form.name || 'Unnamed'} ({preview.normalizedSymbol || '—'})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Supply / Decimals</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {Number(form.totalSupply || 0).toLocaleString('en-US')} / {form.decimals}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Mint Authority</span>
                <span className={form.mintRevoked ? 'text-emerald-400' : 'text-amber-400'}>
                  {form.mintRevoked ? 'Revoked On-Chain' : 'Retained by You'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Freeze Authority</span>
                <span className={form.freezeRevoked ? 'text-emerald-400' : 'text-amber-400'}>
                  {form.freezeRevoked ? 'Revoked On-Chain' : 'Retained by You'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-medium">Solana Network Rent</span>
                <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                  ~{BASE_DEPLOY_FEE_SOL} SOL
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Platform Markup</span>
                <span className="font-mono text-slate-300">0 SOL</span>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800/80 space-y-2 text-xs text-slate-400 leading-relaxed">
              <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Atomic SPL Instructions</span>
              </div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>SystemProgram.createAccount (SPL Mint)</li>
                <li>InitializeMint2 ({form.decimals} decimals)</li>
                <li>CreateAssociatedTokenAccount (Your Wallet)</li>
                <li>MintTo (100% of supply directly to your ATA)</li>
                {form.mintRevoked && <li>SetAuthority (MintTokens → null)</li>}
              </ol>
              <p className="pt-1 text-[11px] text-slate-500">
                100% of minted tokens land in your own Solana wallet so you can create a Raydium/Meteora pool or withdraw them anytime.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* TAB 2: COPY LIVE TRENDING COINS (100% REAL DEXSCREENER SOLANA PAIRS) */}
      {studioTab === 'copy' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="inline-flex p-1 rounded-lg bg-[#0F1624] border border-slate-800">
                {(['trending', 'new'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTrendingTab(t)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      trendingTab === t
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t === 'trending' ? 'Live Trending' : 'New (<72h)'}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filter trending coins by DEX"
                value={platformFilter}
                onChange={(e) =>
                  setPlatformFilter(e.target.value as 'All' | LaunchPlatform)
                }
                className="px-3 py-2 rounded-lg bg-[#0F1624] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60"
              >
                <option value="All">All Solana DEXs</option>
                <option value="Raydium">Raydium</option>
                <option value="Meteora">Meteora</option>
                <option value="PumpSwap">PumpSwap</option>
                <option value="pump.fun">pump.fun</option>
                <option value="Orca">Orca</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => void loadLiveTrending(true)}
              disabled={refreshingTrending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-200 self-start sm:self-auto"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshingTrending ? 'animate-spin' : ''}`}
              />
              <span>Refresh Live DexScreener Feed</span>
            </button>
          </div>

          {trendingError && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
            >
              {trendingError}
            </div>
          )}

          {refreshingTrending && visibleTrending.length === 0 ? (
            <div className="p-12 rounded-xl bg-[#0F1624] border border-slate-800 text-center text-sm text-slate-400">
              Loading live trending Solana markets from DexScreener...
            </div>
          ) : visibleTrending.length === 0 ? (
            <div className="p-10 rounded-xl bg-[#0F1624] border border-slate-800 text-center text-sm text-slate-400">
              No live Solana tokens match this DEX filter right now. Try "All Solana DEXs" or click Refresh.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleTrending.map((coin) => (
                <div
                  key={coin.id}
                  className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-5 space-y-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {coin.imageUrl ? (
                        <img
                          src={coin.imageUrl}
                          alt={`${coin.name} emblem`}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm text-slate-950 shrink-0"
                          style={{ backgroundColor: coin.accentColor }}
                        >
                          {coin.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-display font-bold text-slate-100 truncate">
                          {coin.name}
                        </div>
                        <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                          <span>${coin.symbol}</span>
                          <span>·</span>
                          <span>{coin.platform}</span>
                          {typeof coin.change24h === 'number' && (
                            <span
                              className={
                                coin.change24h >= 0
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                              }
                            >
                              {formatPercent(coin.change24h)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-slate-500">Market Cap</div>
                      <div className="font-mono text-sm font-bold text-emerald-400 tabular-nums">
                        {formatCompactUsd(coin.marketCapUsd)}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {coin.description}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                    <div className="space-y-1">
                      <div className="text-xs font-mono text-amber-400">
                        {coin.lastBuyLabel} · Liq {formatCompactUsd(coin.liquidityUsd ?? 0)}
                      </div>
                      {coin.address && (
                        <TokenExplorerLinks
                          address={coin.address}
                          symbol={coin.symbol}
                          pairAddress={coin.pairAddress}
                          dexUrl={coin.dexUrl}
                          network="Mainnet-Beta"
                          variant="compact"
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => applyClonedCoin(coin)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Use Template</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: REAL DEX LISTING & BOOST PORTAL */}
      {studioTab === 'boost' && (
        <div className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-6 space-y-5 max-w-3xl">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Official On-Chain Listing & DexScreener Boost Launcher
            </h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Select any live or newly minted Solana SPL token to open its operational Solscan verification page, Raydium/Meteora liquidity pool creation portal, or official DexScreener Boost & Enhanced Token Info checkout.
            </p>
          </div>

          <div>
            <label
              htmlFor="boost-token-select"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Select Solana SPL Token
            </label>
            <select
              id="boost-token-select"
              value={boostTokenAddr || selectedBoostToken?.address || ''}
              onChange={(e) => setBoostTokenAddr(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
            >
              {tokens.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol} — {t.name} ({shortenAddress(t.address)})
                </option>
              ))}
            </select>
          </div>

          {selectedBoostToken && (
            <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-display text-base font-bold text-slate-100">
                    {selectedBoostToken.name} (${selectedBoostToken.symbol})
                  </div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">
                    Mint: {selectedBoostToken.address}
                  </div>
                </div>
                <span className="font-mono text-xs text-emerald-400">
                  {selectedBoostToken.cluster ?? wallet.network}
                </span>
              </div>

              <TokenExplorerLinks
                address={selectedBoostToken.address}
                symbol={selectedBoostToken.symbol}
                pairAddress={selectedBoostToken.pairAddress}
                dexUrl={selectedBoostToken.dexUrl}
                network={selectedBoostToken.cluster ?? wallet.network}
                variant="buttons"
                showPools
                showMeteora
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
                <a
                  href={getRaydiumCreatePoolUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-emerald-500/50 transition-colors space-y-1"
                >
                  <div className="text-xs font-semibold text-emerald-400 inline-flex items-center gap-1">
                    <span>1. Create Raydium Pool</span>
                    <ExternalLink className="w-3 h-3" />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Seed SOL/SPL CPMM liquidity on Raydium so DexScreener auto-indexes live price & chart.
                  </p>
                </a>

                <a
                  href={getMeteoraCreatePoolUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-emerald-500/50 transition-colors space-y-1"
                >
                  <div className="text-xs font-semibold text-emerald-400 inline-flex items-center gap-1">
                    <span>2. Create Meteora DLMM</span>
                    <ExternalLink className="w-3 h-3" />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Launch dynamic-fee liquidity bins on Meteora for instant Jupiter v6 routing.
                  </p>
                </a>

                <a
                  href={getDexScreenerTokenUrl(
                    selectedBoostToken.address,
                    selectedBoostToken.pairAddress
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-amber-500/50 transition-colors space-y-1"
                >
                  <div className="text-xs font-semibold text-amber-400 inline-flex items-center gap-1">
                    <span>3. DexScreener Boost</span>
                    <ExternalLink className="w-3 h-3" />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Open official DexScreener pair page to purchase real Golden Ticker & Trending Boosts.
                  </p>
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
