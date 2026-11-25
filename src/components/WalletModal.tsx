import {
  ArrowUpRight,
  Check,
  Cloud,
  Copy,
  Download,
  Droplets,
  Eye,
  ExternalLink,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  closeEmptyTokenAccountOnChain,
  detectInjectedWallets,
  exportLocalKeypairJson,
  hasStoredLocalKeypair,
  verifyExtensionMessageSignature,
  withdrawSolOnChain,
  withdrawSplTokenOnChain,
} from '../services/solanaOnChain';
import type {
  AuthUserSummary,
  LedgerTransaction,
  OnChainTokenAccount,
  SolanaCluster,
  WalletOnChainSnapshot,
  WalletProviderId,
  WalletState,
} from '../types/solana';
import {
  formatUsd,
  getSolscanAccountUrl,
  getSolscanTxUrl,
  shortenAddress,
} from '../utils/solanaLogic';
import { isValidSolanaPublicKey } from '../utils/solanaRpc';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface WalletModalProps {
  open: boolean;
  wallet: WalletState;
  walletSnapshot: WalletOnChainSnapshot | null;
  walletLoading: boolean;
  authUser: AuthUserSummary | null;
  onClose: () => void;
  onConnect: (
    provider: WalletProviderId,
    network: SolanaCluster,
    options?: { address?: string; importSecret?: string; createNewKeypair?: boolean }
  ) => Promise<void>;
  onDisconnect: () => void;
  onSwitchNetwork: (network: SolanaCluster) => void;
  onRefreshOnChain: () => Promise<void>;
  onRecordOnChainTx: (tx: Omit<LedgerTransaction, 'id' | 'timestamp'>) => void;
  onSignInGoogle: () => Promise<void>;
  onSignOutGoogle: () => Promise<void>;
}

export function WalletModal({
  open,
  wallet,
  walletSnapshot,
  walletLoading,
  authUser,
  onClose,
  onConnect,
  onDisconnect,
  onSwitchNetwork,
  onRefreshOnChain,
  onRecordOnChainTx,
  onSignInGoogle,
  onSignOutGoogle,
}: WalletModalProps) {
  const [selectedNetwork, setSelectedNetwork] = useState<SolanaCluster>(
    wallet.network
  );
  const [connecting, setConnecting] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<{
    message: string;
    txSignature?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Watch address & Import keypair inputs
  const [watchInput, setWatchInput] = useState('');
  const [showImportKeypair, setShowImportKeypair] = useState(false);
  const [importSecret, setImportSecret] = useState('');

  // Connected wallet tabs: Assets vs Withdraw
  const [activeTab, setActiveTab] = useState<'assets' | 'withdraw'>('assets');
  const [withdrawAssetMint, setWithdrawAssetMint] = useState<string>('SOL');
  const [withdrawDest, setWithdrawDest] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [airdropping, setAirdropping] = useState(false);
  const [closingAccount, setClosingAccount] = useState<string | null>(null);
  const [verifyingSigner, setVerifyingSigner] = useState(false);
  const [detected, setDetected] = useState(() => detectInjectedWallets());

  useEffect(() => {
    if (!open) return;
    setSelectedNetwork(wallet.network);
    const refreshDetected = () => setDetected(detectInjectedWallets());
    refreshDetected();
    const timer = setTimeout(refreshDetected, 400);
    window.addEventListener('load', refreshDetected);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('load', refreshDetected);
    };
  }, [open, wallet.network]);

  if (!open) return null;

  const hasPhantom = detected.phantom;
  const hasSolflare = detected.solflare;
  const hasBackpack = detected.backpack;
  const inIframe = detected.inIframe;
  const hasStoredKeypair = hasStoredLocalKeypair();

  const tokenAccounts = walletSnapshot?.tokenAccounts ?? [];
  const activeTokens = tokenAccounts.filter((a) => !a.isEmpty);
  const emptyAccounts = tokenAccounts.filter((a) => a.isEmpty);
  const solBalance = walletSnapshot?.solBalance ?? wallet.balances.SOL ?? 0;

  const selectedWithdrawAccount: OnChainTokenAccount | undefined =
    withdrawAssetMint === 'SOL'
      ? undefined
      : activeTokens.find(
          (a) => a.tokenAccount === withdrawAssetMint || a.mint === withdrawAssetMint
        );

  const handleConnectExtension = async (providerId: WalletProviderId) => {
    setError(null);
    setStatusNotice(null);
    setConnecting(providerId);
    try {
      await onConnect(providerId, selectedNetwork);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not connect wallet extension.'
      );
    } finally {
      setConnecting(null);
    }
  };

  const handleKeypairConnect = async (createNew: boolean) => {
    setError(null);
    setStatusNotice(null);
    setConnecting(createNew ? 'keypair-new' : 'keypair-existing');
    try {
      await onConnect('keypair', selectedNetwork, { createNewKeypair: createNew });
      setStatusNotice({
        message: createNew
          ? 'Generated new non-custodial Ed25519 Solana keypair locally in your browser. Back up your secret key before depositing Mainnet SOL.'
          : 'Loaded your local Solana Ed25519 keypair.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Keypair setup failed.');
    } finally {
      setConnecting(null);
    }
  };

  const handleImportKeypair = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusNotice(null);
    setConnecting('keypair-import');
    try {
      await onConnect('keypair', selectedNetwork, { importSecret });
      setImportSecret('');
      setShowImportKeypair(false);
      setStatusNotice({
        message: 'Imported Ed25519 keypair locally and retrieved live on-chain Solana balances.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid secret key format.');
    } finally {
      setConnecting(null);
    }
  };

  const handleWatchConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusNotice(null);
    const clean = watchInput.trim();
    if (!isValidSolanaPublicKey(clean)) {
      setError('Enter a valid Solana wallet public key (Base58 address).');
      return;
    }
    setConnecting('watch');
    try {
      await onConnect('watch', selectedNetwork, { address: clean });
      setWatchInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect wallet address.');
    } finally {
      setConnecting(null);
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setAuthLoading(true);
    try {
      await onSignInGoogle();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Google Sign-In was canceled or failed.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDevnetAirdrop = async () => {
    if (!wallet.address || wallet.network !== 'Devnet') return;
    setError(null);
    setStatusNotice(null);
    setAirdropping(true);
    try {
      const res = await fetch('/api/solana/devnet-airdrop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address }),
      });
      const data = (await res.json()) as {
        signature?: string;
        amountSol?: number;
        error?: string;
      };
      if (!res.ok || !data.signature) {
        throw new Error(data.error || 'Devnet airdrop failed.');
      }

      onRecordOnChainTx({
        txType: 'AIRDROP',
        fromChain: 'solana',
        toChain: 'solana',
        fromSymbol: 'DEVNET',
        toSymbol: 'SOL',
        fromAmount: 0,
        toAmount: data.amountSol ?? 1,
        feeSol: 0,
        priceImpactPct: 0,
        routeProvider: 'Solana Devnet Faucet',
        summary: `Received +${data.amountSol ?? 1} real Devnet SOL on-chain airdrop.`,
        mevProtected: true,
        txHash: data.signature,
        status: 'Confirmed',
      });

      setStatusNotice({
        message: 'Confirmed +1 real Devnet SOL airdrop on Solana Devnet!',
        txSignature: data.signature,
      });
      setTimeout(() => void onRefreshOnChain(), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Devnet airdrop failed.');
    } finally {
      setAirdropping(false);
    }
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusNotice(null);

    if (!wallet.canSign) {
      setError(
        'Watch-only wallets cannot sign withdrawals. Connect Phantom, Solflare, Backpack, or import your Keypair.'
      );
      return;
    }

    const dest = withdrawDest.trim();
    if (!isValidSolanaPublicKey(dest)) {
      setError('Enter a valid destination Solana wallet address.');
      return;
    }

    const amt = Number(withdrawAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a withdrawal amount greater than 0.');
      return;
    }

    setWithdrawing(true);
    try {
      if (withdrawAssetMint === 'SOL') {
        const result = await withdrawSolOnChain({
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
          txHash: result.signature,
          status: 'Confirmed',
        });
        setStatusNotice({
          message: `Successfully withdrew ${amt} SOL on-chain to ${shortenAddress(dest)}.`,
          txSignature: result.signature,
        });
      } else if (selectedWithdrawAccount) {
        const result = await withdrawSplTokenOnChain({
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
          txHash: result.signature,
          status: 'Confirmed',
        });
        setStatusNotice({
          message: `Successfully withdrew ${amt.toLocaleString('en-US')} ${selectedWithdrawAccount.symbol} on-chain to ${shortenAddress(dest)}.`,
          txSignature: result.signature,
        });
      } else {
        throw new Error('Select a valid token balance to withdraw.');
      }

      setWithdrawAmount('');
      await onRefreshOnChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'On-chain withdrawal failed.');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleCloseEmptyAccount = async (acc: OnChainTokenAccount) => {
    if (!wallet.canSign) {
      setError('Connect a signing wallet to close empty token accounts and reclaim rent.');
      return;
    }
    setError(null);
    setStatusNotice(null);
    setClosingAccount(acc.tokenAccount);
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
        routeProvider: 'Solana SPL Rent Reclaim',
        summary: `Closed empty ${acc.symbol} token account and reclaimed ~0.00204 SOL rent.`,
        mevProtected: true,
        txHash: res.signature,
        status: 'Confirmed',
      });
      setStatusNotice({
        message: `Closed empty ${acc.symbol} account and reclaimed ~0.00204 SOL rent.`,
        txSignature: res.signature,
      });
      await onRefreshOnChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close empty token account.');
    } finally {
      setClosingAccount(null);
    }
  };

  const handleCopyAddress = () => {
    if (!wallet.address) return;
    navigator.clipboard?.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleVerifyExtensionSigner = async () => {
    if (!wallet.connected || !wallet.address || !wallet.canSign) return;
    setError(null);
    setStatusNotice(null);
    setVerifyingSigner(true);
    try {
      const res = await verifyExtensionMessageSignature(
        wallet.provider,
        wallet.address,
        wallet.network
      );
      setStatusNotice({
        message: `${wallet.providerLabel} extension verified! Ed25519 signature confirmed for ${shortenAddress(res.signer)} (${res.signatureHex.slice(0, 14)}...).`,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Extension signature check failed.'
      );
    } finally {
      setVerifyingSigner(false);
    }
  };

  const handleExportLocalKey = async () => {
    const json = await exportLocalKeypairJson();
    if (!json) return;
    navigator.clipboard?.writeText(json);
    setCopiedKey(true);
    setStatusNotice({
      message:
        'Copied your 64-byte Solana CLI keypair JSON to clipboard. Keep it private — anyone with this array controls the wallet.',
    });
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const maxWithdrawable =
    withdrawAssetMint === 'SOL'
      ? Math.max(0, Number((solBalance - 0.00001).toFixed(6)))
      : selectedWithdrawAccount?.uiAmount ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-[#0F1624] border border-slate-800">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-[#0F1624] z-10">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <h2
              id="wallet-modal-title"
              className="font-display text-base font-semibold text-slate-100"
            >
              {wallet.connected
                ? 'On-Chain Solana Wallet & Withdrawals'
                : 'Connect Real Solana Wallet'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet dialog"
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-slate-800/70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Cluster Selector */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-300">
                Solana RPC Cluster
              </span>
              <p className="text-[11px] text-slate-500">
                Mainnet-Beta for live markets · Devnet for free real on-chain testing
              </p>
            </div>
            <div className="inline-flex p-1 rounded-lg bg-[#090D16] border border-slate-800 shrink-0">
              {(['Mainnet-Beta', 'Devnet'] as const).map((net) => {
                const active = (wallet.connected ? wallet.network : selectedNetwork) === net;
                return (
                  <button
                    key={net}
                    type="button"
                    onClick={() => {
                      setSelectedNetwork(net);
                      if (wallet.connected) onSwitchNetwork(net);
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {net}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed"
            >
              {error}
            </div>
          )}

          {statusNotice && (
            <div
              role="status"
              className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 space-y-1.5 leading-relaxed"
            >
              <div>{statusNotice.message}</div>
              {statusNotice.txSignature && (
                <a
                  href={getSolscanTxUrl(statusNotice.txSignature, wallet.network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:text-emerald-100 underline"
                >
                  <span>Verify Transaction on Solscan ({shortenAddress(statusNotice.txSignature)})</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {wallet.connected ? (
            <div className="space-y-4">
              {/* Connected Address Header */}
              <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-medium text-slate-200">
                    {wallet.providerLabel}
                    {!wallet.canSign && ' (Read-Only Watch)'}
                  </span>
                  <span className="font-mono text-emerald-400">{wallet.network}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs sm:text-sm text-slate-100 truncate">
                    {wallet.address}
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onRefreshOnChain()}
                      disabled={walletLoading}
                      aria-label="Refresh on-chain wallet assets"
                      title="Refresh on-chain balances"
                      className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-md hover:bg-slate-800"
                    >
                      <RefreshCw className={`w-4 h-4 ${walletLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <a
                      href={getSolscanAccountUrl(wallet.address, wallet.network)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View connected wallet on Solscan"
                      title="View on Solscan"
                      className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-md hover:bg-slate-800"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      aria-label="Copy wallet address"
                      className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-md hover:bg-slate-800"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Live SOL & Portfolio Total */}
                <div className="pt-2 border-t border-slate-800/80 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500">Retrieved On-Chain Balance</div>
                    <div className="font-mono text-xl font-bold text-slate-50 tabular-nums">
                      {solBalance.toFixed(6)} SOL
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Total Live Value</div>
                    <div className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {walletSnapshot
                        ? formatUsd(walletSnapshot.totalValueUsd)
                        : '$0.00'}
                    </div>
                  </div>
                </div>

                {/* Real Devnet Faucet + Extension Signer Check + Keypair Export Row */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {wallet.network === 'Devnet' && (
                    <button
                      type="button"
                      disabled={airdropping}
                      onClick={() => void handleDevnetAirdrop()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-semibold transition-colors"
                    >
                      <Droplets className="w-3.5 h-3.5" />
                      <span>
                        {airdropping ? 'Requesting Devnet SOL...' : 'Request 1 Real Devnet SOL'}
                      </span>
                    </button>
                  )}
                  {(wallet.provider === 'phantom' ||
                    wallet.provider === 'solflare' ||
                    wallet.provider === 'backpack') && (
                    <button
                      type="button"
                      disabled={verifyingSigner}
                      onClick={() => void handleVerifyExtensionSigner()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-emerald-300 text-xs font-medium transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {verifyingSigner
                          ? `Approve in ${wallet.providerLabel}...`
                          : `Verify ${wallet.providerLabel} Signer`}
                      </span>
                    </button>
                  )}
                  {wallet.provider === 'keypair' && (
                    <button
                      type="button"
                      onClick={() => void handleExportLocalKey()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-amber-400" />
                      <span>{copiedKey ? 'Secret Key Copied' : 'Backup Keypair JSON'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Assets vs Withdraw Tabs */}
              <div className="grid grid-cols-2 p-1 rounded-lg bg-[#090D16] border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('assets')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    activeTab === 'assets'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  On-Chain Assets ({activeTokens.length + 1})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('withdraw')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors inline-flex items-center justify-center gap-1.5 ${
                    activeTab === 'withdraw'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Withdraw SOL / SPL</span>
                </button>
              </div>

              {activeTab === 'assets' ? (
                <div className="space-y-3">
                  <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-[#090D16] max-h-60 overflow-y-auto">
                    {/* Native SOL */}
                    <div className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100">SOL (Native)</div>
                        <div className="text-[11px] text-slate-500">
                          {wallet.network} · {formatUsd(walletSnapshot?.solValueUsd ?? 0)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono tabular-nums text-slate-100 text-xs sm:text-sm">
                          {solBalance.toFixed(6)}
                        </span>
                        {wallet.canSign && solBalance > 0.0001 && (
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawAssetMint('SOL');
                              setActiveTab('withdraw');
                            }}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-[11px] font-semibold text-emerald-400 transition-colors"
                          >
                            Withdraw
                          </button>
                        )}
                      </div>
                    </div>

                    {/* All Retrieved On-Chain SPL & Token-2022 Accounts */}
                    {activeTokens.map((acc) => (
                      <div
                        key={acc.tokenAccount}
                        className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-medium text-slate-200 truncate">
                            {acc.symbol}{' '}
                            <span className="text-xs text-slate-500 font-normal">
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
                            <div className="text-slate-100 text-xs sm:text-sm">
                              {acc.uiAmount >= 1000
                                ? acc.uiAmount.toLocaleString('en-US', {
                                    maximumFractionDigits: 2,
                                  })
                                : acc.uiAmount.toLocaleString('en-US', {
                                    maximumFractionDigits: 6,
                                  })}
                            </div>
                            {acc.valueUsd > 0 && (
                              <div className="text-[11px] text-slate-500">
                                {formatUsd(acc.valueUsd)}
                              </div>
                            )}
                          </div>
                          {wallet.canSign && (
                            <button
                              type="button"
                              onClick={() => {
                                setWithdrawAssetMint(acc.tokenAccount);
                                setActiveTab('withdraw');
                              }}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-[11px] font-semibold text-emerald-400 transition-colors"
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {activeTokens.length === 0 && !walletLoading && (
                      <div className="px-4 py-4 text-xs text-slate-500 text-center">
                        No non-zero SPL or Token-2022 balances found on {wallet.network} for this address.
                      </div>
                    )}
                  </div>

                  {/* Empty Token Accounts Rent Reclaim */}
                  {emptyAccounts.length > 0 && (
                    <div className="p-3.5 rounded-lg bg-[#090D16] border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-200">
                          Reclaimable SOL Rent ({emptyAccounts.length} empty SPL accounts)
                        </span>
                        <span className="font-mono text-emerald-400">
                          ~{(emptyAccounts.length * 0.00204).toFixed(4)} SOL
                        </span>
                      </div>
                      <div className="space-y-1.5 max-h-28 overflow-y-auto">
                        {emptyAccounts.slice(0, 6).map((acc) => (
                          <div
                            key={acc.tokenAccount}
                            className="flex items-center justify-between text-xs text-slate-400"
                          >
                            <span className="font-mono truncate">
                              {acc.symbol} ({shortenAddress(acc.tokenAccount)})
                            </span>
                            <button
                              type="button"
                              disabled={!wallet.canSign || closingAccount === acc.tokenAccount}
                              onClick={() => void handleCloseEmptyAccount(acc)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-emerald-300 font-medium shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>
                                {closingAccount === acc.tokenAccount
                                  ? 'Closing...'
                                  : 'Reclaim SOL'}
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* On-Chain Withdrawal Form */
                <form
                  onSubmit={handleWithdrawSubmit}
                  className="p-4 rounded-lg bg-[#090D16] border border-slate-800 space-y-3.5"
                >
                  <div>
                    <label
                      htmlFor="withdraw-asset-select"
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                    >
                      Asset to Withdraw ({wallet.network})
                    </label>
                    <select
                      id="withdraw-asset-select"
                      value={withdrawAssetMint}
                      onChange={(e) => {
                        setWithdrawAssetMint(e.target.value);
                        setWithdrawAmount('');
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-[#0F1624] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
                    >
                      <option value="SOL">
                        SOL (Native) — Available: {solBalance.toFixed(6)} SOL
                      </option>
                      {activeTokens.map((acc) => (
                        <option key={acc.tokenAccount} value={acc.tokenAccount}>
                          {acc.symbol} ({shortenAddress(acc.tokenAccount)}) — Available:{' '}
                          {acc.uiAmount.toLocaleString('en-US')}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="withdraw-dest-address"
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                    >
                      Destination Solana Wallet Address
                    </label>
                    <input
                      id="withdraw-dest-address"
                      type="text"
                      value={withdrawDest}
                      onChange={(e) => setWithdrawDest(e.target.value)}
                      placeholder="Paste recipient Solana address (e.g. Phantom / hardware wallet)"
                      className="w-full px-3 py-2 rounded-lg bg-[#0F1624] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5 text-xs">
                      <label htmlFor="withdraw-amount-input" className="text-slate-300 font-medium">
                        Amount
                      </label>
                      <div className="flex items-center gap-2 font-mono text-slate-400">
                        <span>Max: {maxWithdrawable.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
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
                      id="withdraw-amount-input"
                      type="number"
                      step="any"
                      min="0"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg bg-[#0F1624] border border-slate-800 text-sm font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500/60"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={withdrawing || !wallet.canSign}
                    className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>
                      {!wallet.canSign
                        ? 'Signing Wallet Required'
                        : withdrawing
                          ? 'Broadcasting On-Chain...'
                          : `Withdraw ${withdrawAssetMint === 'SOL' ? 'SOL' : selectedWithdrawAccount?.symbol ?? 'Token'} On-Chain`}
                    </span>
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => {
                  onDisconnect();
                  onClose();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm font-medium transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Disconnect Wallet</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 1. Browser Wallet Extensions */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-400">
                  Browser Wallet Extensions (Live Signing)
                </div>
                {(
                  [
                    {
                      id: 'phantom' as WalletProviderId,
                      name: 'Phantom',
                      note: 'Solana SPL token launch, swaps & withdrawals',
                      detected: hasPhantom,
                    },
                    {
                      id: 'solflare' as WalletProviderId,
                      name: 'Solflare',
                      note: 'Native Solana wallet signing',
                      detected: hasSolflare,
                    },
                    {
                      id: 'backpack' as WalletProviderId,
                      name: 'Backpack',
                      note: 'Multi-chain Solana wallet signing',
                      detected: hasBackpack,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={connecting !== null}
                    onClick={() => void handleConnectExtension(item.id)}
                    className="w-full px-4 py-3 rounded-lg bg-[#090D16] border border-slate-800 hover:border-slate-700 text-left transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-100">
                        {item.name}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">
                        {item.note}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                        item.detected ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {connecting === item.id
                        ? 'Connecting...'
                        : item.detected
                          ? 'Detected'
                          : 'Not Installed'}
                    </span>
                  </button>
                ))}
                {inIframe && !hasPhantom && (
                  <p className="text-[11px] text-amber-300/90 leading-relaxed pt-1">
                    Browser extensions like Phantom only inject into top-level browser tabs. Open this app URL directly in its own tab to sign Mainnet transactions directly in Phantom.
                  </p>
                )}
              </div>

              {/* 2. Non-Custodial Browser Ed25519 Keypair */}
              <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/30 space-y-3">
                <div className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      Non-Custodial Browser Solana Keypair
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                      Generate or import a real Ed25519 Solana keypair directly in your browser to mint real SPL tokens, swap via Jupiter v6, and withdraw funds anytime. Keys never leave this device.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {hasStoredKeypair && (
                    <button
                      type="button"
                      disabled={connecting !== null}
                      onClick={() => void handleKeypairConnect(false)}
                      className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors"
                    >
                      {connecting === 'keypair-existing'
                        ? 'Loading...'
                        : 'Load Saved Keypair'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={connecting !== null}
                    onClick={() => void handleKeypairConnect(true)}
                    className={`px-3.5 py-2 rounded-lg font-semibold text-xs transition-colors ${
                      hasStoredKeypair
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                    }`}
                  >
                    {connecting === 'keypair-new'
                      ? 'Generating...'
                      : 'Generate New Solana Keypair'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImportKeypair((prev) => !prev)}
                    className="px-3.5 py-2 rounded-lg border border-slate-700 hover:border-slate-600 text-slate-300 text-xs font-medium transition-colors"
                  >
                    {showImportKeypair ? 'Cancel Import' : 'Import Keypair JSON'}
                  </button>
                </div>

                {showImportKeypair && (
                  <form onSubmit={handleImportKeypair} className="space-y-2 pt-1">
                    <textarea
                      rows={2}
                      value={importSecret}
                      onChange={(e) => setImportSecret(e.target.value)}
                      placeholder="Paste 64-byte Solana CLI JSON array [12, 34, ...] or 128-char hex key"
                      className="w-full px-3 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                    />
                    <button
                      type="submit"
                      disabled={connecting !== null}
                      className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs"
                    >
                      Import & Retrieve Assets
                    </button>
                  </form>
                )}
              </div>

              {/* 3. Watch Any Solana Address (Full On-Chain Asset Retrieval) */}
              <form
                onSubmit={handleWatchConnect}
                className="p-4 rounded-lg bg-[#090D16] border border-slate-800 space-y-2.5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Inspect / Watch Any Solana Wallet Address</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={watchInput}
                    onChange={(e) => setWatchInput(e.target.value)}
                    placeholder="Paste any Solana public key to retrieve all assets..."
                    aria-label="Solana wallet public key to inspect"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#0F1624] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                  />
                  <button
                    type="submit"
                    disabled={connecting !== null}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold whitespace-nowrap"
                  >
                    {connecting === 'watch' ? 'Loading...' : 'Retrieve'}
                  </button>
                </div>
              </form>

              <div className="flex items-start gap-2 pt-1 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  100% real Solana RPC balances & non-custodial client-side signing. Private keys are never transmitted to any server or database.
                </span>
              </div>
            </div>
          )}

          {/* Optional Cloud Sync Account */}
          <div className="p-4 rounded-lg bg-[#090D16] border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Cloud
                  className={`w-4 h-4 ${
                    authUser ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                />
                <span>Firestore Account Sync (Optional)</span>
              </div>
              <span
                className={`text-xs font-medium ${
                  authUser ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {authUser ? 'Synced' : 'Local Session'}
              </span>
            </div>

            {authUser ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-100 truncate">
                    {authUser.displayName || 'YABBAI Account'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {authUser.email}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onSignOutGoogle()}
                  className="px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-colors shrink-0"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Sync alert rules, announcements & verified tx receipts across devices.
                </p>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => void handleGoogleAuth()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  {authLoading ? 'Signing in...' : 'Google Sign-In'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
