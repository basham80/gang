import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Droplets,
  ExternalLink,
  Flame,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  burnSplTokenOnChain,
  closeEmptyTokenAccountOnChain,
} from '../services/solanaOnChain';
import type {
  LedgerTransaction,
  LiquidityDex,
  OnChainTokenAccount,
  OnChainTokenInspection,
  SolanaToken,
  WalletOnChainSnapshot,
  WalletState,
} from '../types/solana';
import {
  formatCompactUsd,
  formatUsd,
  getDexScreenerTokenUrl,
  getMeteoraCreatePoolUrl,
  getMeteoraPoolUrl,
  getRaydiumCreatePoolUrl,
  getRaydiumPoolUrl,
  getSolscanTokenUrl,
  getSolscanTxUrl,
  shortenAddress,
} from '../utils/solanaLogic';
import { isValidSolanaPublicKey } from '../utils/solanaRpc';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface ManageLiquidityViewProps {
  tokens: SolanaToken[];
  wallet: WalletState;
  walletSnapshot: WalletOnChainSnapshot | null;
  walletLoading: boolean;
  onRequireWallet: () => void;
  onRefreshWallet: () => Promise<void>;
  onRecordOnChainTx: (tx: Omit<LedgerTransaction, 'id' | 'timestamp'>) => void;
}

export function ManageLiquidityView({
  tokens,
  wallet,
  walletSnapshot,
  walletLoading,
  onRequireWallet,
  onRefreshWallet,
  onRecordOnChainTx,
}: ManageLiquidityViewProps) {
  const [dex, setDex] = useState<LiquidityDex>('Raydium');
  const [tokenAddress, setTokenAddress] = useState<string>('');
  const [customMintInput, setCustomMintInput] = useState<string>('');

  const [inspection, setInspection] = useState<OnChainTokenInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    message: string;
    txSignature?: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyAddress = (key: string, addr: string) => {
    navigator.clipboard?.writeText(addr);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Combine user wallet SPL accounts + launched tokens + live market tokens for selector
  const selectableTokens = useMemo(() => {
    const byMint = new Map<
      string,
      { address: string; symbol: string; name: string; tag: string }
    >();

    for (const acc of walletSnapshot?.tokenAccounts ?? []) {
      if (!acc.isEmpty) {
        byMint.set(acc.mint, {
          address: acc.mint,
          symbol: acc.symbol,
          name: acc.name,
          tag: `In Wallet (${acc.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })})`,
        });
      }
    }

    for (const t of tokens) {
      if (!byMint.has(t.address)) {
        byMint.set(t.address, {
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          tag: t.launchedByUser ? 'Your On-Chain Launch' : t.dexSource || 'Live DEX',
        });
      }
    }

    return [...byMint.values()];
  }, [tokens, walletSnapshot]);

  const activeMint = tokenAddress || selectableTokens[0]?.address || '';

  const inspectMintOnChain = useCallback(
    async (mintAddr: string) => {
      if (!mintAddr || !isValidSolanaPublicKey(mintAddr)) return;
      setInspecting(true);
      setInspectError(null);
      try {
        const res = await fetch(
          `/api/solana/token/${encodeURIComponent(mintAddr)}?network=${encodeURIComponent(wallet.network)}`
        );
        const data = (await res.json()) as {
          inspection?: OnChainTokenInspection;
          error?: string;
        };
        if (!res.ok || !data.inspection) {
          throw new Error(data.error || 'Could not inspect mint on Solana RPC.');
        }
        setInspection(data.inspection);
      } catch (err) {
        setInspectError(
          err instanceof Error ? err.message : 'Failed to load live on-chain pools.'
        );
      } finally {
        setInspecting(false);
      }
    },
    [wallet.network]
  );

  useEffect(() => {
    if (activeMint) {
      void inspectMintOnChain(activeMint);
    }
  }, [activeMint, inspectMintOnChain]);

  const handleLookupCustomMint = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customMintInput.trim();
    if (!isValidSolanaPublicKey(clean)) {
      setInspectError('Paste a valid Base58 Solana SPL mint address.');
      return;
    }
    setTokenAddress(clean);
    setCustomMintInput('');
  };

  const handleBurnSplOnChain = async (acc: OnChainTokenAccount, pct: number) => {
    if (!wallet.connected || !wallet.canSign) {
      setActionError(
        'Connect Phantom, Solflare, Backpack, or a Local Solana Keypair to sign on-chain SPL/LP burns.'
      );
      onRequireWallet();
      return;
    }
    setActionError(null);
    setActionNotice(null);
    setActionBusy(`burn-${acc.tokenAccount}`);
    try {
      const burnAmount =
        pct >= 100
          ? acc.uiAmount
          : Number(((acc.uiAmount * pct) / 100).toFixed(Math.min(acc.decimals, 6)));
      const res = await burnSplTokenOnChain({
        network: wallet.network,
        provider: wallet.provider,
        ownerAddress: wallet.address,
        tokenAccountAddress: acc.tokenAccount,
        mintAddress: acc.mint,
        amountUi: burnAmount,
        decimals: acc.decimals,
        programId: acc.programId,
      });
      onRecordOnChainTx({
        txType: 'BURN',
        fromChain: 'solana',
        toChain: 'solana',
        fromSymbol: acc.symbol,
        toSymbol: 'BURN',
        fromAmount: burnAmount,
        toAmount: 0,
        feeSol: 0.000005,
        priceImpactPct: 0,
        routeProvider: `Solana ${wallet.network} SPL Incinerator`,
        summary: `Burned ${burnAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${acc.symbol} on-chain (${pct}%).`,
        mevProtected: true,
        txHash: res.signature,
        status: 'Confirmed',
      });
      setActionNotice({
        message: `Confirmed on-chain burn of ${burnAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${acc.symbol}.`,
        txSignature: res.signature,
      });
      await onRefreshWallet();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'On-chain burn failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleCloseEmptyAccount = async (acc: OnChainTokenAccount) => {
    if (!wallet.connected || !wallet.canSign) {
      setActionError(
        'Connect a signing wallet to close empty token accounts and reclaim rent.'
      );
      onRequireWallet();
      return;
    }
    setActionError(null);
    setActionNotice(null);
    setActionBusy(`close-${acc.tokenAccount}`);
    try {
      const res = await closeEmptyTokenAccountOnChain({
        network: wallet.network,
        provider: wallet.provider,
        ownerAddress: wallet.address,
        tokenAccountAddress: acc.tokenAccount,
        programId: acc.programId,
      });
      onRecordOnChainTx({
        txType: 'WITHDRAW',
        fromChain: 'solana',
        toChain: 'solana',
        fromSymbol: acc.symbol,
        toSymbol: 'SOL',
        fromAmount: 0,
        toAmount: 0.002039,
        feeSol: 0.000005,
        priceImpactPct: 0,
        routeProvider: `Solana ${wallet.network} Rent Reclaim`,
        summary: `Closed empty ${acc.symbol} token account and reclaimed ~0.00204 SOL rent.`,
        mevProtected: true,
        txHash: res.signature,
        status: 'Confirmed',
      });
      setActionNotice({
        message: `Closed empty ${acc.symbol} account and reclaimed ~0.00204 SOL directly to your wallet.`,
        txSignature: res.signature,
      });
      await onRefreshWallet();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to close empty account.');
    } finally {
      setActionBusy(null);
    }
  };

  const selectedMeta = selectableTokens.find((t) => t.address === activeMint);
  const walletAccounts = walletSnapshot?.tokenAccounts ?? [];
  const activeWalletAccounts = walletAccounts.filter((a) => !a.isEmpty);
  const emptyWalletAccounts = walletAccounts.filter((a) => a.isEmpty);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header + Raydium / Meteora Switcher */}
      <div className="text-center space-y-4">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50">
            On-Chain Liquidity & LP Manager
          </h1>
          <p className="text-sm text-slate-400">
            Inspect live Raydium, Meteora, and Orca pools via Solana RPC & DexScreener, open official DEX pools for newly minted tokens, or burn SPL/LP tokens and reclaim rent directly on-chain.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Select Target Solana Liquidity DEX"
          className="inline-flex items-center p-1 rounded-full bg-[#0F1624] border border-slate-800"
        >
          {(['Raydium', 'Meteora'] as LiquidityDex[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={dex === option}
              onClick={() => setDex(option)}
              className={`px-6 py-2 text-sm font-semibold rounded-full transition-colors whitespace-nowrap ${
                dex === option
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {/* Token Selector + Custom Mint Lookup + Official Pool Launcher */}
      <section className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label
            htmlFor="pool-token-select"
            className="text-sm font-semibold text-slate-100"
          >
            Select SPL Token Mint to Inspect or List on {dex}
          </label>
          {!wallet.connected && (
            <button
              type="button"
              onClick={onRequireWallet}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 self-start sm:self-auto"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Connect wallet to load your SPL & LP accounts →</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <select
            id="pool-token-select"
            value={activeMint}
            onChange={(e) => setTokenAddress(e.target.value)}
            className="md:col-span-7 px-4 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
          >
            {selectableTokens.length === 0 && (
              <option value="">Loading live Solana tokens...</option>
            )}
            {selectableTokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} — {t.name} ({t.tag})
              </option>
            ))}
          </select>

          <form onSubmit={handleLookupCustomMint} className="md:col-span-5 flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={customMintInput}
                onChange={(e) => setCustomMintInput(e.target.value)}
                placeholder="Or paste any SPL mint..."
                aria-label="Inspect any Solana token mint address"
                className="w-full pl-8 pr-3 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 whitespace-nowrap"
            >
              Inspect
            </button>
          </form>
        </div>

        {inspectError && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
          >
            {inspectError}
          </div>
        )}

        {activeMint && (
          <div className="space-y-4 pt-3 border-t border-slate-800/80">
            {/* Mint Verification Strip + Direct Pool Creation CTA */}
            <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-500">Mint Address:</span>
                    <a
                      href={getSolscanTokenUrl(activeMint, wallet.network)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-slate-100 hover:text-emerald-400"
                    >
                      <code>{activeMint}</code>
                      <ExternalLink className="w-3 h-3 opacity-70 shrink-0" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopyAddress('active-mint', activeMint)}
                      aria-label="Copy selected mint address"
                      className="text-slate-400 hover:text-emerald-400"
                    >
                      {copiedKey === 'active-mint' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {inspection && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-slate-400">
                      <span>
                        RPC Status:{' '}
                        <strong
                          className={
                            inspection.existsOnChain ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          {inspection.existsOnChain ? 'Verified On-Chain' : 'Not Found on Cluster'}
                        </strong>
                      </span>
                      <span>
                        Mint Auth:{' '}
                        <strong
                          className={
                            inspection.mintRevoked ? 'text-emerald-400' : 'text-amber-400'
                          }
                        >
                          {inspection.mintRevoked ? 'Revoked' : 'Active'}
                        </strong>
                      </span>
                      <span>
                        Freeze Auth:{' '}
                        <strong
                          className={
                            inspection.freezeRevoked ? 'text-emerald-400' : 'text-amber-400'
                          }
                        >
                          {inspection.freezeRevoked ? 'Revoked (DEX Ready)' : 'Active (Blocks Raydium)'}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href={dex === 'Raydium' ? getRaydiumCreatePoolUrl() : getMeteoraCreatePoolUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap"
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>Open {dex} Create Pool</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href={
                      dex === 'Raydium'
                        ? getRaydiumPoolUrl(activeMint)
                        : getMeteoraPoolUrl(activeMint)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <span>Browse {dex} Pools</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-2 pt-2 border-t border-slate-800/70 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  To list a newly minted SPL token on DexScreener & Jupiter, copy its verified mint address above and seed an official on-chain pool on {dex}. Once the first swap confirms, live pools appear automatically below.
                </span>
              </div>
            </div>

            {/* Live Discovered On-Chain Liquidity Pools for Selected Mint */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-slate-200">
                  Live On-Chain Liquidity Pools for{' '}
                  {selectedMeta?.symbol ?? shortenAddress(activeMint)} (
                  {inspection?.pools.length ?? 0})
                </h2>
                <button
                  type="button"
                  disabled={inspecting}
                  onClick={() => void inspectMintOnChain(activeMint)}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${inspecting ? 'animate-spin' : ''}`} />
                  <span>Refresh Pools</span>
                </button>
              </div>

              {inspecting && !inspection ? (
                <div className="p-6 rounded-lg bg-[#090D16] border border-slate-800 text-center text-xs text-slate-400">
                  Querying Solana RPC & live DEX liquidity pools...
                </div>
              ) : inspection && inspection.pools.length > 0 ? (
                <div className="divide-y divide-slate-800/70 rounded-lg bg-[#090D16] border border-slate-800 overflow-hidden">
                  {inspection.pools.slice(0, 8).map((pool) => (
                    <div
                      key={pool.pairAddress}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display font-bold text-slate-100 text-sm">
                            {pool.baseSymbol} / {pool.quoteSymbol}
                          </span>
                          <span className="text-emerald-400 font-semibold">
                            {pool.dexLabel}
                          </span>
                          <span className="font-mono text-slate-500">
                            Pool {shortenAddress(pool.pairAddress)}
                          </span>
                        </div>
                        <div className="font-mono tabular-nums text-slate-400">
                          Price {formatUsd(pool.priceUsd)} · Liquidity{' '}
                          <span className="text-slate-200">
                            {formatCompactUsd(pool.liquidityUsd)}
                          </span>{' '}
                          · 24h Vol {formatCompactUsd(pool.volume24h)} ·{' '}
                          {pool.buys24h.toLocaleString('en-US')} buys /{' '}
                          {pool.sells24h.toLocaleString('en-US')} sells
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={pool.dexUrl || getDexScreenerTokenUrl(activeMint, pool.pairAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-emerald-300 font-medium"
                        >
                          <span>DexScreener Pool</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <a
                          href={getSolscanTokenUrl(pool.pairAddress, wallet.network)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-700 hover:border-slate-600 text-slate-300"
                        >
                          <span>Solscan</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 rounded-lg bg-[#090D16] border border-slate-800 text-center space-y-2">
                  <p className="text-xs text-slate-400">
                    No active Mainnet DEX liquidity pools indexed yet for this mint.
                  </p>
                  <p className="text-[11px] text-slate-500">
                    If you just minted this token, click &ldquo;Open {dex} Create Pool&rdquo; above to seed initial SOL/SPL liquidity on-chain.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Connected Wallet Real SPL / LP Token Accounts (Burn + Rent Reclaim + Withdraw) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Droplets className="w-4 h-4 text-emerald-400" />
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Your Retrieved On-Chain SPL & LP Token Accounts
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {wallet.connected && (
              <button
                type="button"
                onClick={onRequireWallet}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Withdraw SOL / SPL</span>
              </button>
            )}
            <button
              type="button"
              disabled={walletLoading || !wallet.connected}
              onClick={() => void onRefreshWallet()}
              aria-label="Refresh on-chain wallet SPL and LP accounts"
              className="p-2 rounded-lg bg-[#0F1624] border border-slate-800 hover:border-slate-700 disabled:opacity-40 text-slate-300 hover:text-slate-100 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${walletLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {actionError && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
          >
            {actionError}
          </div>
        )}

        {actionNotice && (
          <div
            role="status"
            className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{actionNotice.message}</span>
            </div>
            {actionNotice.txSignature && (
              <a
                href={getSolscanTxUrl(actionNotice.txSignature, wallet.network)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:text-emerald-100 underline shrink-0"
              >
                <span>Solscan Tx ({shortenAddress(actionNotice.txSignature)})</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {!wallet.connected ? (
          <div className="rounded-xl bg-[#0F1624] border border-slate-800/80 py-12 px-6 text-center space-y-3">
            <p className="text-sm text-slate-300">
              Connect a Solana wallet or paste any public key to retrieve all live SPL, Token-2022, and LP token accounts on {wallet.network}.
            </p>
            <button
              type="button"
              onClick={onRequireWallet}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors"
            >
              Connect or Inspect Wallet
            </button>
          </div>
        ) : activeWalletAccounts.length === 0 && emptyWalletAccounts.length === 0 ? (
          <div className="rounded-xl bg-[#0F1624] border border-slate-800/80 py-12 px-6 text-center">
            <p className="text-sm text-slate-400">
              No SPL or LP token accounts found on {wallet.network} for {wallet.shortAddress}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeWalletAccounts.map((acc) => (
              <div
                key={acc.tokenAccount}
                className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-display font-bold text-slate-100">
                      {acc.symbol}
                    </span>
                    <span className="text-xs text-slate-400">{acc.name}</span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-xs text-emerald-400 tabular-nums">
                      Balance:{' '}
                      {acc.uiAmount.toLocaleString('en-US', {
                        maximumFractionDigits: Math.min(acc.decimals, 6),
                      })}
                    </span>
                    {acc.valueUsd > 0 && (
                      <span className="font-mono text-xs text-slate-400">
                        ({formatUsd(acc.valueUsd)})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleCopyAddress(acc.tokenAccount, acc.mint)}
                      className="inline-flex items-center gap-1 font-mono text-xs text-slate-400 hover:text-emerald-400"
                    >
                      <span>Mint {shortenAddress(acc.mint)}</span>
                      {copiedKey === acc.tokenAccount ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <TokenExplorerLinks
                      address={acc.mint}
                      symbol={acc.symbol}
                      pairAddress={acc.pairAddress}
                      network={wallet.network}
                      variant="compact"
                      showPools
                      showMeteora
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setTokenAddress(acc.mint)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    Inspect Pools
                  </button>
                  <button
                    type="button"
                    onClick={onRequireWallet}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-300 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span>Withdraw</span>
                  </button>
                  <button
                    type="button"
                    disabled={!wallet.canSign || actionBusy === `burn-${acc.tokenAccount}`}
                    onClick={() => void handleBurnSplOnChain(acc, 100)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 hover:bg-amber-500/10 disabled:opacity-40 text-amber-300 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>
                      {actionBusy === `burn-${acc.tokenAccount}`
                        ? 'Burning...'
                        : 'Burn 100% On-Chain'}
                    </span>
                  </button>
                </div>
              </div>
            ))}

            {emptyWalletAccounts.length > 0 && (
              <div className="rounded-xl bg-[#0F1624] border border-slate-800/80 p-5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">
                    Empty Token Accounts ({emptyWalletAccounts.length}) — Close On-Chain to Reclaim SOL Rent
                  </span>
                  <span className="font-mono text-emerald-400">
                    ~{(emptyWalletAccounts.length * 0.00204).toFixed(4)} SOL recoverable
                  </span>
                </div>
                <div className="divide-y divide-slate-800/70">
                  {emptyWalletAccounts.slice(0, 10).map((acc) => (
                    <div
                      key={acc.tokenAccount}
                      className="py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="font-mono text-slate-400 truncate">
                        {acc.symbol} · ATA {shortenAddress(acc.tokenAccount)} · Mint{' '}
                        {shortenAddress(acc.mint)}
                      </div>
                      <button
                        type="button"
                        disabled={!wallet.canSign || actionBusy === `close-${acc.tokenAccount}`}
                        onClick={() => void handleCloseEmptyAccount(acc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-emerald-300 font-semibold shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>
                          {actionBusy === `close-${acc.tokenAccount}`
                            ? 'Closing...'
                            : 'Close & Reclaim ~0.002 SOL'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
