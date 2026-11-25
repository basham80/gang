import {
  ArrowDownUp,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Shield,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CANONICAL_SOLANA_MINTS } from '../data/seedData';
import {
  executeJupiterSwapOnChain,
  withdrawSolOnChain,
  withdrawSplTokenOnChain,
} from '../services/solanaOnChain';
import type {
  JupiterQuoteSummary,
  LedgerTransaction,
  SolanaToken,
  SwapRecord,
  WalletOnChainSnapshot,
  WalletState,
} from '../types/solana';
import {
  formatRelativeTime,
  formatUsd,
  getSolscanTxUrl,
  shortenAddress,
  SOL_MINT_ADDRESS,
  USDC_MINT_ADDRESS,
} from '../utils/solanaLogic';
import {
  fromRawTokenAmount,
  isValidSolanaPublicKey,
  toRawTokenAmount,
} from '../utils/solanaRpc';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface MultiChainTradeViewProps {
  tokens: SolanaToken[];
  wallet: WalletState;
  walletSnapshot: WalletOnChainSnapshot | null;
  walletLoading: boolean;
  swapHistory: SwapRecord[];
  preselectedSymbol: string | null;
  onOpenWalletModal: () => void;
  onRefreshWallet: () => Promise<void>;
  onExecuteSwap: (record: SwapRecord) => void;
  onRecordOnChainTx: (tx: Omit<LedgerTransaction, 'id' | 'timestamp'>) => void;
}

interface TradeTokenOption {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  pairAddress?: string;
}

export function MultiChainTradeView({
  tokens,
  wallet,
  walletSnapshot,
  walletLoading,
  swapHistory,
  preselectedSymbol,
  onOpenWalletModal,
  onRefreshWallet,
  onExecuteSwap,
  onRecordOnChainTx,
}: MultiChainTradeViewProps) {
  const [deskTab, setDeskTab] = useState<'swap' | 'withdraw'>('swap');

  // Build deduplicated live Solana token list from live market feed + wallet SPL accounts + canonical Solana mints
  const tradeCatalog = useMemo<TradeTokenOption[]>(() => {
    const byMint = new Map<string, TradeTokenOption>();

    for (const c of CANONICAL_SOLANA_MINTS) {
      byMint.set(c.address, {
        address: c.address,
        symbol: c.symbol,
        name: c.name,
        decimals: c.decimals,
        priceUsd: c.address === USDC_MINT_ADDRESS ? 1 : 0,
      });
    }

    for (const t of tokens) {
      const existing = byMint.get(t.address);
      byMint.set(t.address, {
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals ?? existing?.decimals ?? 9,
        priceUsd: t.priceUsd > 0 ? t.priceUsd : existing?.priceUsd ?? 0,
        pairAddress: t.pairAddress,
      });
    }

    for (const acc of walletSnapshot?.tokenAccounts ?? []) {
      if (!acc.isEmpty) {
        const existing = byMint.get(acc.mint);
        byMint.set(acc.mint, {
          address: acc.mint,
          symbol: existing?.symbol ?? acc.symbol,
          name: existing?.name ?? acc.name,
          decimals: acc.decimals,
          priceUsd: acc.priceUsd > 0 ? acc.priceUsd : existing?.priceUsd ?? 0,
          pairAddress: acc.pairAddress ?? existing?.pairAddress,
        });
      }
    }

    return [...byMint.values()];
  }, [tokens, walletSnapshot]);

  const preselectedMint = useMemo(() => {
    if (!preselectedSymbol || preselectedSymbol === 'SOL') return USDC_MINT_ADDRESS;
    const match = tradeCatalog.find(
      (t) => t.symbol.toUpperCase() === preselectedSymbol.toUpperCase()
    );
    return match?.address ?? USDC_MINT_ADDRESS;
  }, [preselectedSymbol, tradeCatalog]);

  const [fromMint, setFromMint] = useState<string>(SOL_MINT_ADDRESS);
  const [toMint, setToMint] = useState<string>(preselectedMint);
  const [amountStr, setAmountStr] = useState<string>('0.1');
  const [slippageBps, setSlippageBps] = useState<number>(50);

  const [quote, setQuote] = useState<JupiterQuoteSummary | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [txNotice, setTxNotice] = useState<{
    message: string;
    txSignature?: string;
  } | null>(null);

  // Built-in Withdraw tab state
  const [withdrawAssetMint, setWithdrawAssetMint] = useState<string>('SOL');
  const [withdrawDest, setWithdrawDest] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    if (preselectedSymbol && preselectedSymbol !== 'SOL') {
      const match = tradeCatalog.find(
        (t) => t.symbol.toUpperCase() === preselectedSymbol.toUpperCase()
      );
      if (match && match.address !== fromMint) {
        setToMint(match.address);
      }
    }
  }, [preselectedSymbol, tradeCatalog, fromMint]);

  const fromToken =
    tradeCatalog.find((t) => t.address === fromMint) ?? tradeCatalog[0];
  const toToken =
    tradeCatalog.find((t) => t.address === toMint) ?? tradeCatalog[1] ?? tradeCatalog[0];

  const getWalletBalanceForMint = useCallback(
    (mint: string): number => {
      if (!wallet.connected) return 0;
      if (mint === SOL_MINT_ADDRESS) {
        return walletSnapshot?.solBalance ?? wallet.balances.SOL ?? 0;
      }
      const acc = walletSnapshot?.tokenAccounts.find((a) => a.mint === mint);
      return acc?.uiAmount ?? 0;
    },
    [wallet.connected, wallet.balances.SOL, walletSnapshot]
  );

  const availableFromBalance = fromToken ? getWalletBalanceForMint(fromToken.address) : 0;
  const amountNum = Number(amountStr);

  // Live Jupiter v6 Quote fetching (debounced)
  const fetchLiveQuote = useCallback(async () => {
    if (!fromToken || !toToken || fromToken.address === toToken.address) {
      setQuote(null);
      setQuoteError(
        fromToken?.address === toToken?.address
          ? 'Select two different Solana tokens.'
          : null
      );
      return;
    }

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    const rawAmount = toRawTokenAmount(amountStr, fromToken.decimals);
    if (rawAmount <= 0n) {
      setQuote(null);
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const params = new URLSearchParams({
        inputMint: fromToken.address,
        outputMint: toToken.address,
        amount: rawAmount.toString(),
        slippageBps: String(slippageBps),
      });
      const res = await fetch(`/api/solana/jupiter-quote?${params.toString()}`);
      const data = (await res.json()) as {
        quote?: JupiterQuoteSummary;
        error?: string;
      };
      if (!res.ok || !data.quote) {
        throw new Error(data.error || 'No live Jupiter v6 route available for this pair.');
      }
      setQuote(data.quote);
    } catch (err) {
      setQuote(null);
      setQuoteError(
        err instanceof Error ? err.message : 'Jupiter v6 live quote failed.'
      );
    } finally {
      setQuoteLoading(false);
    }
  }, [fromToken, toToken, amountStr, amountNum, slippageBps]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchLiveQuote();
    }, 350);
    return () => clearTimeout(timer);
  }, [fetchLiveQuote]);

  const estimatedOutUi = useMemo(() => {
    if (!quote || !toToken) return 0;
    return fromRawTokenAmount(quote.outAmount, toToken.decimals);
  }, [quote, toToken]);

  const minimumReceivedUi = useMemo(() => {
    if (!quote || !toToken) return 0;
    return fromRawTokenAmount(quote.otherAmountThreshold, toToken.decimals);
  }, [quote, toToken]);

  const handleFlip = () => {
    setFromMint(toMint);
    setToMint(fromMint);
    setQuote(null);
    setSwapError(null);
    setTxNotice(null);
  };

  const handleSwapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwapError(null);
    setTxNotice(null);

    if (!wallet.connected || !wallet.canSign) {
      setSwapError(
        'Connect Phantom, Solflare, Backpack, or a Local Solana Keypair to sign and execute live Jupiter v6 swaps.'
      );
      onOpenWalletModal();
      return;
    }
    if (!quote || !fromToken || !toToken) {
      setSwapError('Wait for a live Jupiter v6 route quote before executing.');
      return;
    }
    if (amountNum > availableFromBalance) {
      setSwapError(
        `Insufficient ${fromToken.symbol} balance (${availableFromBalance.toLocaleString('en-US', { maximumFractionDigits: 6 })} available).`
      );
      return;
    }

    setSwapping(true);
    try {
      const result = await executeJupiterSwapOnChain({
        network: wallet.network,
        provider: wallet.provider,
        userPublicKey: wallet.address,
        quoteResponse: quote.rawQuoteResponse,
      });

      const record: SwapRecord = {
        id: `swap-${result.signature.slice(0, 16)}`,
        fromChain: 'solana',
        toChain: 'solana',
        fromSymbol: fromToken.symbol,
        toSymbol: toToken.symbol,
        fromAmount: amountNum,
        toAmount: Number(estimatedOutUi.toPrecision(6)),
        priceImpactPct: quote.priceImpactPct,
        routeProvider: `Jupiter v6 (${quote.routeLabels.slice(0, 2).join(' → ')})`,
        mevProtected: true,
        txHash: result.signature,
        status: 'Confirmed',
        timestamp: new Date().toISOString(),
      };

      onExecuteSwap(record);
      setTxNotice({
        message: `Confirmed on-chain swap: ${amountNum} ${fromToken.symbol} → ${record.toAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${toToken.symbol}.`,
        txSignature: result.signature,
      });
      await onRefreshWallet();
    } catch (err) {
      setSwapError(
        err instanceof Error ? err.message : 'Jupiter v6 on-chain swap failed.'
      );
    } finally {
      setSwapping(false);
    }
  };

  const activeWalletTokens = (walletSnapshot?.tokenAccounts ?? []).filter(
    (a) => !a.isEmpty
  );
  const solBalance = walletSnapshot?.solBalance ?? wallet.balances.SOL ?? 0;
  const selectedWithdrawAccount =
    withdrawAssetMint === 'SOL'
      ? undefined
      : activeWalletTokens.find(
          (a) => a.tokenAccount === withdrawAssetMint || a.mint === withdrawAssetMint
        );
  const maxWithdrawable =
    withdrawAssetMint === 'SOL'
      ? Math.max(0, Number((solBalance - 0.00001).toFixed(6)))
      : selectedWithdrawAccount?.uiAmount ?? 0;

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwapError(null);
    setTxNotice(null);

    if (!wallet.connected || !wallet.canSign) {
      setSwapError(
        'Connect Phantom, Solflare, Backpack, or a Local Solana Keypair to withdraw funds on-chain.'
      );
      onOpenWalletModal();
      return;
    }
    const dest = withdrawDest.trim();
    if (!isValidSolanaPublicKey(dest)) {
      setSwapError('Enter a valid destination Solana wallet address.');
      return;
    }
    const amt = Number(withdrawAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setSwapError('Enter a withdrawal amount greater than 0.');
      return;
    }

    setWithdrawing(true);
    try {
      if (withdrawAssetMint === 'SOL') {
        const res = await withdrawSolOnChain({
          network: wallet.network,
          provider: wallet.provider,
          fromAddress: wallet.address,
          recipientAddress: dest,
          amountSol: amt,
        });
        onRecordOnChainTx({
          txType: 'WITHDRAW',
          fromChain: 'solana',
          toChain: 'solana',
          fromSymbol: 'SOL',
          toSymbol: 'SOL',
          fromAmount: amt,
          toAmount: amt,
          feeSol: 0.000005,
          priceImpactPct: 0,
          routeProvider: `Solana ${wallet.network} SystemProgram`,
          summary: `Withdrew ${amt} SOL to ${shortenAddress(dest)}.`,
          mevProtected: true,
          txHash: res.signature,
          status: 'Confirmed',
        });
        setTxNotice({
          message: `Confirmed on-chain withdrawal of ${amt} SOL to ${shortenAddress(dest)}.`,
          txSignature: res.signature,
        });
      } else if (selectedWithdrawAccount) {
        const res = await withdrawSplTokenOnChain({
          network: wallet.network,
          provider: wallet.provider,
          fromAddress: wallet.address,
          recipientAddress: dest,
          mintAddress: selectedWithdrawAccount.mint,
          sourceTokenAccount: selectedWithdrawAccount.tokenAccount,
          amountUi: amt,
          decimals: selectedWithdrawAccount.decimals,
          programId: selectedWithdrawAccount.programId,
        });
        onRecordOnChainTx({
          txType: 'WITHDRAW',
          fromChain: 'solana',
          toChain: 'solana',
          fromSymbol: selectedWithdrawAccount.symbol,
          toSymbol: selectedWithdrawAccount.symbol,
          fromAmount: amt,
          toAmount: amt,
          feeSol: 0.00001,
          priceImpactPct: 0,
          routeProvider: `Solana ${wallet.network} SPL Token`,
          summary: `Withdrew ${amt.toLocaleString('en-US')} ${selectedWithdrawAccount.symbol} to ${shortenAddress(dest)}.`,
          mevProtected: true,
          txHash: res.signature,
          status: 'Confirmed',
        });
        setTxNotice({
          message: `Confirmed on-chain withdrawal of ${amt.toLocaleString('en-US')} ${selectedWithdrawAccount.symbol} to ${shortenAddress(dest)}.`,
          txSignature: res.signature,
        });
      } else {
        throw new Error('Select a held asset to withdraw.');
      }
      setWithdrawAmount('');
      await onRefreshWallet();
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'On-chain withdrawal failed.');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50">
            Solana Live Trade & Withdraw Desk
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time Jupiter v6 AMM liquidity quotes & atomic Solana execution, plus direct on-chain SOL and SPL token withdrawals.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Trade Desk Mode"
          className="inline-flex p-1 rounded-lg bg-[#0F1624] border border-slate-800 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={deskTab === 'swap'}
            onClick={() => {
              setDeskTab('swap');
              setSwapError(null);
            }}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              deskTab === 'swap'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Jupiter v6 Swap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deskTab === 'withdraw'}
            onClick={() => {
              setDeskTab('withdraw');
              setSwapError(null);
            }}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              deskTab === 'withdraw'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Withdraw Assets</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Live Jupiter v6 Swap OR Direct On-Chain Withdraw */}
        {deskTab === 'swap' ? (
          <form
            onSubmit={handleSwapSubmit}
            className="lg:col-span-6 rounded-xl bg-[#0F1624] border border-slate-800/80 p-6 space-y-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-semibold text-slate-100">
                  Jupiter v6 Live Spot Swap
                </h2>
                <button
                  type="button"
                  onClick={() => void fetchLiveQuote()}
                  aria-label="Refresh live Jupiter quote"
                  className="p-1 text-slate-400 hover:text-emerald-400 rounded"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${quoteLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-400">Slippage:</span>
                {[
                  { bps: 25, label: '0.25%' },
                  { bps: 50, label: '0.5%' },
                  { bps: 100, label: '1%' },
                ].map((opt) => (
                  <button
                    key={opt.bps}
                    type="button"
                    onClick={() => setSlippageBps(opt.bps)}
                    className={`px-2 py-1 rounded font-mono tabular-nums transition-colors ${
                      slippageBps === opt.bps
                        ? 'bg-slate-800 text-emerald-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {txNotice && (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-1.5 text-xs text-emerald-200"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{txNotice.message}</span>
                </div>
                {txNotice.txSignature && (
                  <a
                    href={getSolscanTxUrl(txNotice.txSignature, wallet.network)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:text-emerald-100 underline pl-6"
                  >
                    <span>Verify on Solscan ({shortenAddress(txNotice.txSignature)})</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* Pay Side */}
            <div className="p-4 rounded-xl bg-[#090D16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">You Pay (Solana SPL)</span>
                {wallet.connected ? (
                  <div className="flex items-center gap-2 font-mono tabular-nums text-slate-400">
                    <span>
                      Bal: {availableFromBalance.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAmountStr(String(Number((availableFromBalance * 0.5).toFixed(6))))
                      }
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const maxVal =
                          fromToken?.address === SOL_MINT_ADDRESS
                            ? Math.max(0, availableFromBalance - 0.005)
                            : availableFromBalance;
                        setAmountStr(String(Number(maxVal.toFixed(6))));
                      }}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      Max
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-500">Wallet not connected</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <label className="sr-only" htmlFor="swap-from-asset">
                  Pay token
                </label>
                <select
                  id="swap-from-asset"
                  value={fromToken?.address ?? ''}
                  onChange={(e) => setFromMint(e.target.value)}
                  className="max-w-[170px] px-3 py-2.5 rounded-lg bg-[#0F1624] border border-slate-700 text-sm font-semibold text-slate-100 focus:outline-none focus:border-emerald-500/60"
                >
                  {tradeCatalog.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.symbol}
                    </option>
                  ))}
                </select>

                <label className="sr-only" htmlFor="swap-from-amount">
                  Pay amount
                </label>
                <input
                  id="swap-from-amount"
                  type="number"
                  step="any"
                  min="0"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-transparent text-right font-mono text-xl font-semibold text-slate-50 tabular-nums focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                {fromToken ? (
                  <TokenExplorerLinks
                    address={fromToken.address}
                    symbol={fromToken.symbol}
                    pairAddress={fromToken.pairAddress}
                    network={wallet.network}
                    variant="compact"
                  />
                ) : (
                  <span />
                )}
                {fromToken && fromToken.priceUsd > 0 && (
                  <span className="font-mono text-slate-500 tabular-nums">
                    ≈ {formatUsd((Number.isFinite(amountNum) ? amountNum : 0) * fromToken.priceUsd)}
                  </span>
                )}
              </div>
            </div>

            {/* Flip Button */}
            <div className="flex justify-center -my-2">
              <button
                type="button"
                onClick={handleFlip}
                aria-label="Flip swap tokens"
                className="p-2 rounded-lg bg-[#0F1624] border border-slate-700 hover:border-emerald-500/60 text-slate-300 hover:text-emerald-400 transition-colors"
              >
                <ArrowDownUp className="w-4 h-4" />
              </button>
            </div>

            {/* Receive Side */}
            <div className="p-4 rounded-xl bg-[#090D16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">You Receive (Live Jupiter v6 Quote)</span>
                <span className="text-emerald-400 font-mono">
                  {quoteLoading ? 'Fetching route...' : quote ? 'Live AMM Route' : '—'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="sr-only" htmlFor="swap-to-asset">
                  Receive token
                </label>
                <select
                  id="swap-to-asset"
                  value={toToken?.address ?? ''}
                  onChange={(e) => setToMint(e.target.value)}
                  className="max-w-[170px] px-3 py-2.5 rounded-lg bg-[#0F1624] border border-slate-700 text-sm font-semibold text-slate-100 focus:outline-none focus:border-emerald-500/60"
                >
                  {tradeCatalog.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.symbol}
                    </option>
                  ))}
                </select>

                <div className="flex-1 text-right font-mono text-xl font-semibold text-emerald-400 tabular-nums truncate">
                  {estimatedOutUi > 0
                    ? estimatedOutUi.toLocaleString('en-US', {
                        maximumFractionDigits: estimatedOutUi >= 1 ? 4 : 6,
                      })
                    : quoteLoading
                      ? '...'
                      : '0.00'}
                </div>
              </div>

              {toToken && (
                <div className="pt-0.5">
                  <TokenExplorerLinks
                    address={toToken.address}
                    symbol={toToken.symbol}
                    pairAddress={toToken.pairAddress}
                    network={wallet.network}
                    variant="compact"
                    showPools
                  />
                </div>
              )}
            </div>

            {/* Live Route Breakdown */}
            <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800/80 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">AMM Liquidity Route</span>
                <span className="text-slate-200 font-medium text-right truncate">
                  {quote ? quote.routeLabels.join(' → ') : 'Jupiter v6 Aggregator'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Minimum Received</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {minimumReceivedUi > 0
                    ? `${minimumReceivedUi.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${toToken?.symbol}`
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Price Impact</span>
                <span className="font-mono tabular-nums text-slate-300">
                  {quote ? `${quote.priceImpactPct.toFixed(3)}%` : '—'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 text-slate-400">
                <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  Non-custodial VersionedTransaction signed locally by your Solana wallet and broadcast to Mainnet-Beta.
                </span>
              </div>
            </div>

            {(quoteError || swapError) && (
              <p role="alert" className="text-xs text-red-400 leading-relaxed">
                {swapError || quoteError}
              </p>
            )}

            {wallet.connected ? (
              <button
                type="submit"
                disabled={swapping || quoteLoading || !quote || !wallet.canSign}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors"
              >
                {!wallet.canSign
                  ? 'Signing Wallet Required (Watch-Only Connected)'
                  : swapping
                    ? 'Confirming On-Chain Swap...'
                    : 'Execute Live Jupiter v6 Swap'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenWalletModal}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
              >
                <Wallet className="w-4 h-4" />
                <span>Connect Wallet to Execute On-Chain</span>
              </button>
            )}
          </form>
        ) : (
          /* Direct On-Chain Asset Withdrawal Form */
          <form
            onSubmit={handleWithdrawSubmit}
            className="lg:col-span-6 rounded-xl bg-[#0F1624] border border-slate-800/80 p-6 space-y-5"
          >
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Direct On-Chain Withdrawal ({wallet.network})
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Transfer native SOL or any retrieved SPL / Token-2022 asset directly from your connected wallet to Phantom, hardware wallets, or exchanges.
              </p>
            </div>

            {txNotice && (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-1.5 text-xs text-emerald-200"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{txNotice.message}</span>
                </div>
                {txNotice.txSignature && (
                  <a
                    href={getSolscanTxUrl(txNotice.txSignature, wallet.network)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:text-emerald-100 underline pl-6"
                  >
                    <span>Verify Withdrawal on Solscan ({shortenAddress(txNotice.txSignature)})</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {swapError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
              >
                {swapError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="desk-withdraw-asset"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Select Asset to Withdraw
                </label>
                <select
                  id="desk-withdraw-asset"
                  value={withdrawAssetMint}
                  onChange={(e) => {
                    setWithdrawAssetMint(e.target.value);
                    setWithdrawAmount('');
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
                >
                  <option value="SOL">
                    SOL (Native) — Available: {solBalance.toFixed(6)} SOL
                  </option>
                  {activeWalletTokens.map((acc) => (
                    <option key={acc.tokenAccount} value={acc.tokenAccount}>
                      {acc.symbol} ({shortenAddress(acc.tokenAccount)}) — Available:{' '}
                      {acc.uiAmount.toLocaleString('en-US')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="desk-withdraw-dest"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Recipient Solana Address
                </label>
                <input
                  id="desk-withdraw-dest"
                  type="text"
                  value={withdrawDest}
                  onChange={(e) => setWithdrawDest(e.target.value)}
                  placeholder="Paste destination Base58 Solana public key"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <label htmlFor="desk-withdraw-amt" className="text-slate-300 font-medium">
                    Withdrawal Amount
                  </label>
                  <div className="flex items-center gap-2 font-mono text-slate-400">
                    <span>
                      Max: {maxWithdrawable.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawAmount(String(Number((maxWithdrawable * 0.5).toFixed(6))))
                      }
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(String(maxWithdrawable))}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      Max
                    </button>
                  </div>
                </div>
                <input
                  id="desk-withdraw-amt"
                  type="number"
                  step="any"
                  min="0"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500/60"
                />
              </div>
            </div>

            {wallet.connected ? (
              <button
                type="submit"
                disabled={withdrawing || !wallet.canSign}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>
                  {!wallet.canSign
                    ? 'Signing Wallet Required'
                    : withdrawing
                      ? 'Confirming Withdrawal On-Chain...'
                      : `Withdraw ${withdrawAssetMint === 'SOL' ? 'SOL' : selectedWithdrawAccount?.symbol ?? 'Asset'} On-Chain`}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenWalletModal}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
              >
                Connect Wallet to Withdraw
              </button>
            )}
          </form>
        )}

        {/* Right Column: Real Retrieved On-Chain Wallet Balances & Confirmed Executions */}
        <div className="lg:col-span-6 space-y-6">
          <section className="rounded-xl bg-[#0F1624] border border-slate-800/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-100">
                  Retrieved On-Chain Wallet Assets
                </h2>
                {wallet.connected && walletSnapshot && (
                  <p className="text-xs text-slate-500 font-mono">
                    {wallet.network} · Total {formatUsd(walletSnapshot.totalValueUsd)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {wallet.connected && (
                  <button
                    type="button"
                    disabled={walletLoading}
                    onClick={() => void onRefreshWallet()}
                    aria-label="Refresh on-chain wallet balances"
                    className="p-1.5 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-emerald-400"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${walletLoading ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            </div>

            {wallet.connected ? (
              <div className="divide-y divide-slate-800/60 max-h-80 overflow-y-auto">
                {/* Native SOL */}
                <div className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">SOL</div>
                    <div className="text-xs text-slate-500">
                      Native Solana ({wallet.network})
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-slate-100">{solBalance.toFixed(6)}</div>
                      <div className="text-xs text-slate-500">
                        {formatUsd(walletSnapshot?.solValueUsd ?? 0)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setWithdrawAssetMint('SOL');
                        setDeskTab('withdraw');
                      }}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-[11px] font-semibold text-emerald-400 transition-colors"
                    >
                      Withdraw
                    </button>
                  </div>
                </div>

                {/* Live Retrieved SPL / Token-2022 Balances */}
                {activeWalletTokens.map((acc) => (
                  <div
                    key={acc.tokenAccount}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-semibold text-slate-100 truncate">
                        {acc.symbol}{' '}
                        <span className="text-xs font-normal text-slate-500">
                          {acc.name}
                        </span>
                      </div>
                      <TokenExplorerLinks
                        address={acc.mint}
                        symbol={acc.symbol}
                        pairAddress={acc.pairAddress}
                        network={wallet.network}
                        variant="compact"
                      />
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-slate-100">
                          {acc.uiAmount >= 100
                            ? acc.uiAmount.toLocaleString('en-US', {
                                maximumFractionDigits: 2,
                              })
                            : acc.uiAmount.toLocaleString('en-US', {
                                maximumFractionDigits: 6,
                              })}
                        </div>
                        {acc.valueUsd > 0 && (
                          <div className="text-xs text-slate-500">
                            {formatUsd(acc.valueUsd)}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setWithdrawAssetMint(acc.mint);
                          setDeskTab('withdraw');
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-[11px] font-semibold text-emerald-400 transition-colors"
                      >
                        Withdraw
                      </button>
                    </div>
                  </div>
                ))}

                {activeWalletTokens.length === 0 && !walletLoading && (
                  <div className="px-5 py-4 text-xs text-slate-500 text-center">
                    No non-zero SPL token balances detected on {wallet.network}.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center space-y-3">
                <p className="text-sm text-slate-300">
                  Connect Phantom, Solflare, Backpack, a Local Keypair, or watch any Solana address to retrieve all live on-chain balances.
                </p>
                <button
                  type="button"
                  onClick={onOpenWalletModal}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 transition-colors"
                >
                  Open Wallet Selector
                </button>
              </div>
            )}
          </section>

          {/* Recent Confirmed On-Chain Swaps */}
          <section className="rounded-xl bg-[#0F1624] border border-slate-800/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-100">
                Confirmed On-Chain Swaps
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {swapHistory.length} tx
              </span>
            </div>

            {swapHistory.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 text-center">
                No confirmed Jupiter v6 swaps yet. Every executed trade displays its live Solscan signature here.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {swapHistory.map((tx) => (
                  <div key={tx.id} className="px-5 py-3.5 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono tabular-nums text-slate-100 font-medium">
                        {tx.fromAmount} {tx.fromSymbol} →{' '}
                        {tx.toAmount.toLocaleString('en-US', {
                          maximumFractionDigits: 6,
                        })}{' '}
                        {tx.toSymbol}
                      </span>
                      <span className="text-xs font-medium text-emerald-400">
                        {tx.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{tx.routeProvider}</span>
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <a
                          href={getSolscanTxUrl(tx.txHash, wallet.network)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-slate-400 hover:text-emerald-400 transition-colors"
                        >
                          <span>{shortenAddress(tx.txHash)}</span>
                          <ExternalLink className="w-3 h-3 opacity-70" />
                        </a>
                        <span>·</span>
                        <span>{formatRelativeTime(tx.timestamp)}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
