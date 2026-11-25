/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertsView } from './components/AlertsView';
import { AnnouncementsView } from './components/AnnouncementsView';
import { LaunchBoostView } from './components/LaunchBoostView';
import { ManageLiquidityView } from './components/ManageLiquidityView';
import { MultiChainTradeView } from './components/MultiChainTradeView';
import { Sidebar } from './components/Sidebar';
import { TokenGainerView } from './components/TokenGainerView';
import { TopBar } from './components/TopBar';
import { TransactionsView } from './components/TransactionsView';
import { WalletModal } from './components/WalletModal';
import { XTrackerView } from './components/XTrackerView';
import { auth, googleProvider } from './firebase';
import {
  ensureUserWallet,
  persistAcknowledgeAllAlerts,
  persistAlertRuleCreate,
  persistAlertRuleDelete,
  persistAlertRuleToggle,
  persistAnnouncementCreate,
  persistAnnouncementUpvote,
  persistOnChainTransaction,
  persistSwapExecution,
  persistTokenLaunch,
  persistTriggeredAlerts,
  persistWalletNetwork,
  persistWalletOnChainBalances,
  persistXSignalWatch,
  subscribePublicAnnouncements,
  subscribePublicTokens,
  subscribePublicXSignals,
  subscribeUserAlertRules,
  subscribeUserTransactions,
  subscribeUserTriggeredAlerts,
  subscribeUserWallet,
} from './services/firestoreService';
import {
  createLocalSolanaKeypair,
  getInjectedSolanaProvider,
  getStoredLocalKeypair,
  hasStoredLocalKeypair,
  importLocalSolanaKeypair,
} from './services/solanaOnChain';
import type {
  AlertMetric,
  AlertRule,
  Announcement,
  AppSection,
  AuthUserSummary,
  LedgerTransaction,
  SolanaCluster,
  SolanaToken,
  SwapRecord,
  TrendingCoin,
  TriggeredAlert,
  WalletOnChainSnapshot,
  WalletProviderId,
  WalletState,
  XTrackerSignal,
} from './types/solana';
import { evaluateAlertRules, shortenAddress } from './utils/solanaLogic';
import { isValidSolanaPublicKey } from './utils/solanaRpc';

const LOCAL_STORAGE_KEY = 'yabbai_onchain_state_v3';

const DEFAULT_DISCONNECTED_WALLET: WalletState = {
  connected: false,
  provider: null,
  providerLabel: '',
  address: '',
  shortAddress: '',
  network: 'Mainnet-Beta',
  balances: {},
  canSign: false,
};

interface LocalSessionState {
  wallet: WalletState;
  launchedTokens: SolanaToken[];
  localAnnouncements: Announcement[];
  localXSignals: XTrackerSignal[];
  transactions: LedgerTransaction[];
  alertRules: AlertRule[];
  triggeredAlerts: TriggeredAlert[];
}

function loadLocalSession(): Partial<LocalSessionState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<LocalSessionState>;
    // Filter out any invalid wallet addresses or non-on-chain items
    if (
      parsed.wallet &&
      (!parsed.wallet.connected ||
        !isValidSolanaPublicKey(parsed.wallet.address) ||
        parsed.wallet.provider === 'sandbox')
    ) {
      parsed.wallet = DEFAULT_DISCONNECTED_WALLET;
    }
    if (Array.isArray(parsed.launchedTokens)) {
      parsed.launchedTokens = parsed.launchedTokens.filter(
        (t) =>
          isValidSolanaPublicKey(t.address) &&
          typeof t.txSignature === 'string' &&
          t.txSignature.length >= 64
      );
    }
    if (Array.isArray(parsed.transactions)) {
      parsed.transactions = parsed.transactions.filter(
        (tx) => typeof tx.txHash === 'string' && tx.txHash.length >= 64
      );
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveLocalSession(snapshot: LocalSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota errors
  }
}

export default function App() {
  const initialSession = useMemo(() => loadLocalSession(), []);

  const [activeSection, setActiveSection] = useState<AppSection>('gainer');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  // Firebase Auth state
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUserSummary | null>(null);

  // 100% Live Solana Market Data (DexScreener + Solana RPC) + Verified On-Chain Launches
  const [marketTokens, setMarketTokens] = useState<SolanaToken[]>([]);
  const [firestoreTokens, setFirestoreTokens] = useState<SolanaToken[]>([]);
  const [localLaunchedTokens, setLocalLaunchedTokens] = useState<SolanaToken[]>(
    () => initialSession.launchedTokens ?? []
  );

  const [tokensLoading, setTokensLoading] = useState(true);
  const [liveFeedConnected, setLiveFeedConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(new Date().toISOString());
  const [selectedTokenAddress, setSelectedTokenAddress] = useState<string | null>(null);

  // Live Announcements & Verified X Signals
  const [marketAnnouncements, setMarketAnnouncements] = useState<Announcement[]>([]);
  const [firestoreAnnouncements, setFirestoreAnnouncements] = useState<Announcement[]>([]);
  const [localAnnouncements, setLocalAnnouncements] = useState<Announcement[]>(
    () => initialSession.localAnnouncements ?? []
  );

  const [liveXSignals, setLiveXSignals] = useState<XTrackerSignal[]>([]);
  const [firestoreXSignals, setFirestoreXSignals] = useState<XTrackerSignal[]>([]);
  const [localXSignals, setLocalXSignals] = useState<XTrackerSignal[]>(
    () => initialSession.localXSignals ?? []
  );

  // Connected Real Solana Wallet + Retrieved On-Chain RPC Snapshot
  const [wallet, setWallet] = useState<WalletState>(() => {
    const saved = initialSession.wallet;
    if (saved?.connected && isValidSolanaPublicKey(saved.address)) {
      if (saved.provider === 'keypair' && !hasStoredLocalKeypair()) {
        return { ...saved, provider: 'watch', providerLabel: 'Watched Wallet', canSign: false };
      }
      return saved;
    }
    return DEFAULT_DISCONNECTED_WALLET;
  });
  const [walletSnapshot, setWalletSnapshot] = useState<WalletOnChainSnapshot | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  const [transactions, setTransactions] = useState<LedgerTransaction[]>(
    () => initialSession.transactions ?? []
  );
  const [alertRules, setAlertRules] = useState<AlertRule[]>(
    () => initialSession.alertRules ?? []
  );
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>(
    () => initialSession.triggeredAlerts ?? []
  );

  // Cross-app navigation shortcuts
  const [preselectedTradeSymbol, setPreselectedTradeSymbol] = useState<string | null>(null);
  const [preselectedAlertSymbol, setPreselectedAlertSymbol] = useState<string | null>(null);
  const [preselectedBoostAddress, setPreselectedBoostAddress] = useState<string | null>(null);
  const [clonedTrendingCoin, setClonedTrendingCoin] = useState<TrendingCoin | null>(null);

  const authUserRef = useRef<AuthUserSummary | null>(null);
  authUserRef.current = authUser;
  const alertRulesRef = useRef<AlertRule[]>(alertRules);
  alertRulesRef.current = alertRules;
  const triggeredAlertsRef = useRef<TriggeredAlert[]>(triggeredAlerts);
  triggeredAlertsRef.current = triggeredAlerts;
  const walletRef = useRef<WalletState>(wallet);
  walletRef.current = wallet;

  // Merge live market tokens + verified on-chain user launches (deduplicated by mint address)
  const tokens = useMemo(() => {
    const byAddr = new Map<string, SolanaToken>();
    for (const t of marketTokens) {
      byAddr.set(t.address, t);
    }
    for (const t of localLaunchedTokens) {
      const existing = byAddr.get(t.address);
      byAddr.set(
        t.address,
        existing
          ? { ...existing, launchedByUser: true, txSignature: t.txSignature }
          : t
      );
    }
    for (const t of firestoreTokens) {
      const existing = byAddr.get(t.address);
      byAddr.set(
        t.address,
        existing
          ? {
              ...existing,
              launchedByUser: existing.launchedByUser || t.launchedByUser,
              txSignature: existing.txSignature || t.txSignature,
              persistedInDb: true,
            }
          : t
      );
    }
    return [...byAddr.values()];
  }, [marketTokens, localLaunchedTokens, firestoreTokens]);

  // Select first live token once loaded
  useEffect(() => {
    if (!selectedTokenAddress && tokens.length > 0) {
      setSelectedTokenAddress(tokens[0].address);
    }
  }, [selectedTokenAddress, tokens]);

  const announcements = useMemo(() => {
    const byId = new Map<string, Announcement>();
    for (const a of marketAnnouncements) byId.set(a.id, a);
    for (const a of localAnnouncements) byId.set(a.id, a);
    for (const a of firestoreAnnouncements) byId.set(a.id, a);
    return [...byId.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [marketAnnouncements, localAnnouncements, firestoreAnnouncements]);

  const xSignals = useMemo(() => {
    const byId = new Map<string, XTrackerSignal>();
    for (const s of liveXSignals) byId.set(s.id, s);
    for (const s of localXSignals) byId.set(s.id, s);
    for (const s of firestoreXSignals) byId.set(s.id, s);
    return [...byId.values()].sort(
      (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
    );
  }, [liveXSignals, localXSignals, firestoreXSignals]);

  const swapHistory: SwapRecord[] = useMemo(
    () =>
      transactions
        .filter((tx) => tx.txType === 'SWAP')
        .map((tx) => ({
          id: tx.id,
          fromChain: tx.fromChain,
          toChain: tx.toChain,
          fromSymbol: tx.fromSymbol,
          toSymbol: tx.toSymbol,
          fromAmount: tx.fromAmount,
          toAmount: tx.toAmount,
          priceImpactPct: tx.priceImpactPct,
          routeProvider: tx.routeProvider,
          mevProtected: tx.mevProtected,
          txHash: tx.txHash,
          status: 'Confirmed',
          timestamp: tx.timestamp,
        })),
    [transactions]
  );

  // Persist local session state cleanly
  useEffect(() => {
    if (authUser) return;
    saveLocalSession({
      wallet,
      launchedTokens: localLaunchedTokens,
      localAnnouncements,
      localXSignals,
      transactions,
      alertRules,
      triggeredAlerts,
    });
  }, [
    authUser,
    wallet,
    localLaunchedTokens,
    localAnnouncements,
    localXSignals,
    transactions,
    alertRules,
    triggeredAlerts,
  ]);

  // 1. Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setAuthUser({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          photoURL: fbUser.photoURL,
          emailVerified: fbUser.emailVerified,
        });
      } else {
        setAuthUser(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2. Public Firestore streams (strictly verified on-chain tokens, announcements, X watches)
  useEffect(() => {
    const unsubTokens = subscribePublicTokens(setFirestoreTokens);
    const unsubAnnouncements = subscribePublicAnnouncements(setFirestoreAnnouncements);
    const unsubSignals = subscribePublicXSignals(setFirestoreXSignals);
    return () => {
      unsubTokens();
      unsubAnnouncements();
      unsubSignals();
    };
  }, []);

  // 3. Private per-user Firestore streams when signed in
  useEffect(() => {
    if (!authReady || !authUser || !authUser.emailVerified) return;
    const uid = authUser.uid;

    const unsubWallet = subscribeUserWallet(uid, (cloudWallet) => {
      if (cloudWallet && isValidSolanaPublicKey(cloudWallet.address)) {
        if (cloudWallet.provider === 'keypair' && !hasStoredLocalKeypair()) {
          setWallet({
            ...cloudWallet,
            provider: 'watch',
            providerLabel: 'Watched Wallet',
            canSign: false,
          });
          return;
        }
        setWallet(cloudWallet);
      }
    });

    const unsubTxs = subscribeUserTransactions(uid, setTransactions);
    const unsubRules = subscribeUserAlertRules(uid, setAlertRules);
    const unsubAlerts = subscribeUserTriggeredAlerts(uid, setTriggeredAlerts);

    return () => {
      unsubWallet();
      unsubTxs();
      unsubRules();
      unsubAlerts();
    };
  }, [authReady, authUser]);

  // 4. Retrieve ALL live on-chain Solana assets (SOL + SPL + Token-2022 + recent tx signatures)
  const refreshWalletOnChain = useCallback(
    async (overrideAddress?: string, overrideNetwork?: SolanaCluster) => {
      const addr = overrideAddress ?? walletRef.current.address;
      const net = overrideNetwork ?? walletRef.current.network;
      if (!addr || !isValidSolanaPublicKey(addr)) {
        setWalletSnapshot(null);
        return;
      }

      setWalletLoading(true);
      try {
        const res = await fetch(
          `/api/solana/wallet/${encodeURIComponent(addr)}?network=${encodeURIComponent(net)}`
        );
        if (!res.ok) return;
        const snapshot = (await res.json()) as WalletOnChainSnapshot;
        setWalletSnapshot(snapshot);

        // Update wallet.balances map strictly from retrieved on-chain data
        const realBalances: Record<string, number> = {
          SOL: snapshot.solBalance,
        };
        for (const acc of snapshot.tokenAccounts) {
          if (!acc.isEmpty) {
            realBalances[acc.symbol] = (realBalances[acc.symbol] ?? 0) + acc.uiAmount;
          }
        }
        setWallet((prev) =>
          prev.address === addr ? { ...prev, balances: realBalances } : prev
        );

        const user = authUserRef.current;
        if (user && user.emailVerified) {
          void persistWalletOnChainBalances(user.uid, realBalances);
        }
      } catch {
        // Preserve previous snapshot on transient RPC timeout
      } finally {
        setWalletLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!wallet.connected || !isValidSolanaPublicKey(wallet.address)) {
      setWalletSnapshot(null);
      return;
    }
    void refreshWalletOnChain(wallet.address, wallet.network);
    const interval = setInterval(
      () => void refreshWalletOnChain(wallet.address, wallet.network),
      30_000
    );
    return () => clearInterval(interval);
  }, [wallet.connected, wallet.address, wallet.network, refreshWalletOnChain]);

  // Keep connected Phantom / Solflare / Backpack extension synced on account switches or disconnect
  useEffect(() => {
    if (
      !wallet.connected ||
      (wallet.provider !== 'phantom' &&
        wallet.provider !== 'solflare' &&
        wallet.provider !== 'backpack')
    ) {
      return;
    }

    const injected = getInjectedSolanaProvider(wallet.provider);
    if (!injected?.on) return;

    const handleAccountChanged = (nextPk: unknown) => {
      const nextAddr =
        nextPk && typeof (nextPk as { toString?: () => string }).toString === 'function'
          ? (nextPk as { toString: () => string }).toString()
          : '';
      if (isValidSolanaPublicKey(nextAddr)) {
        setWallet((prev) => ({
          ...prev,
          address: nextAddr,
          shortAddress: shortenAddress(nextAddr),
          balances: {},
        }));
      } else {
        setWallet(DEFAULT_DISCONNECTED_WALLET);
        setWalletSnapshot(null);
      }
    };

    const handleProviderDisconnect = () => {
      setWallet(DEFAULT_DISCONNECTED_WALLET);
      setWalletSnapshot(null);
    };

    injected.on('accountChanged', handleAccountChanged);
    injected.on('disconnect', handleProviderDisconnect);

    return () => {
      injected.off?.('accountChanged', handleAccountChanged);
      injected.off?.('disconnect', handleProviderDisconnect);
      injected.removeListener?.('accountChanged', handleAccountChanged);
      injected.removeListener?.('disconnect', handleProviderDisconnect);
    };
  }, [wallet.connected, wallet.provider]);

  // Alert evaluation engine
  const runAlertEvaluation = useCallback(
    (currentTokens: SolanaToken[], overrideRules?: AlertRule[]) => {
      const rulesToCheck = overrideRules ?? alertRulesRef.current;
      const existingTriggered = triggeredAlertsRef.current;
      const { newlyTriggered, updatedRules } = evaluateAlertRules(
        rulesToCheck,
        currentTokens,
        existingTriggered
      );

      if (newlyTriggered.length === 0) return;

      setAlertRules(updatedRules);
      setTriggeredAlerts((prev) => [...newlyTriggered, ...prev]);

      const user = authUserRef.current;
      if (user && user.emailVerified) {
        void persistTriggeredAlerts(user.uid, newlyTriggered, updatedRules);
      }
    },
    []
  );

  // 5. Fetch 100% live market tokens, announcements, and verified X signals
  const fetchMarketData = useCallback(async () => {
    setTokensLoading(true);
    try {
      const [tokensRes, annRes, xRes] = await Promise.all([
        fetch('/api/tokens'),
        fetch('/api/announcements'),
        fetch('/api/x-tracker'),
      ]);

      if (tokensRes.ok) {
        const data = (await tokensRes.json()) as {
          tokens: SolanaToken[];
          liveFeedConnected: boolean;
          lastSyncedAt: string;
        };
        if (Array.isArray(data.tokens)) {
          setMarketTokens(data.tokens);
          setLiveFeedConnected(Boolean(data.liveFeedConnected));
          setLastSyncedAt(data.lastSyncedAt || new Date().toISOString());
          if (data.tokens.length > 0) {
            runAlertEvaluation(data.tokens);
          }
        }
      }

      if (annRes.ok) {
        const annData = (await annRes.json()) as {
          announcements: Announcement[];
        };
        if (Array.isArray(annData.announcements)) {
          setMarketAnnouncements(annData.announcements);
        }
      }

      if (xRes.ok) {
        const xData = (await xRes.json()) as { signals?: XTrackerSignal[] };
        if (Array.isArray(xData.signals)) {
          setLiveXSignals(xData.signals);
        }
      }
    } catch {
      // Preserve last fetched live data on transient network error
    } finally {
      setTokensLoading(false);
    }
  }, [runAlertEvaluation]);

  useEffect(() => {
    void fetchMarketData();
    const interval = setInterval(() => void fetchMarketData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  // Google Sign-In / Sign-Out (Optional Firestore sync)
  const handleSignInGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOutGoogle = async () => {
    await signOut(auth);
  };

  // Real Solana Wallet Connection (Phantom / Solflare / Backpack / Local Ed25519 Keypair / Watch Any Address)
  const handleConnectWallet = async (
    providerId: WalletProviderId,
    network: SolanaCluster,
    options?: { address?: string; importSecret?: string; createNewKeypair?: boolean }
  ) => {
    let nextWallet: WalletState;

    if (providerId === 'phantom') {
      const phantom = getInjectedSolanaProvider('phantom');
      if (!phantom) {
        throw new Error(
          'Phantom browser extension not detected in this window. If you are viewing an embedded preview, open the live app URL directly in a browser tab with Phantom unlocked, or use a Local Solana Keypair below.'
        );
      }
      const resp = await phantom.connect();
      const pubkey =
        (typeof resp === 'object' && resp && 'publicKey' in resp
          ? resp.publicKey?.toString()
          : phantom.publicKey?.toString()) ?? '';
      if (!isValidSolanaPublicKey(pubkey)) {
        throw new Error('Could not read Solana public key from Phantom.');
      }
      nextWallet = {
        connected: true,
        provider: 'phantom',
        providerLabel: 'Phantom',
        address: pubkey,
        shortAddress: shortenAddress(pubkey),
        network,
        balances: {},
        canSign: true,
      };
    } else if (providerId === 'solflare') {
      const solflare = getInjectedSolanaProvider('solflare');
      if (!solflare) {
        throw new Error(
          'Solflare browser extension not detected. Install Solflare or open the live app URL directly in a browser tab.'
        );
      }
      const resp = await solflare.connect();
      const pubkey =
        (typeof resp === 'object' && resp && 'publicKey' in resp
          ? resp.publicKey?.toString()
          : solflare.publicKey?.toString()) ?? '';
      if (!isValidSolanaPublicKey(pubkey)) {
        throw new Error('Could not read Solana public key from Solflare.');
      }
      nextWallet = {
        connected: true,
        provider: 'solflare',
        providerLabel: 'Solflare',
        address: pubkey,
        shortAddress: shortenAddress(pubkey),
        network,
        balances: {},
        canSign: true,
      };
    } else if (providerId === 'backpack') {
      const bp = getInjectedSolanaProvider('backpack');
      if (!bp) {
        throw new Error(
          'Backpack browser extension not detected. Install Backpack or open the live app URL directly in a browser tab.'
        );
      }
      const resp = await bp.connect();
      const pubkey =
        (typeof resp === 'object' && resp && 'publicKey' in resp
          ? resp.publicKey?.toString()
          : bp.publicKey?.toString()) ?? '';
      if (!isValidSolanaPublicKey(pubkey)) {
        throw new Error('Could not read Solana public key from Backpack.');
      }
      nextWallet = {
        connected: true,
        provider: 'backpack',
        providerLabel: 'Backpack',
        address: pubkey,
        shortAddress: shortenAddress(pubkey),
        network,
        balances: {},
        canSign: true,
      };
    } else if (providerId === 'keypair') {
      let pubkey: string;
      if (options?.importSecret) {
        pubkey = (await importLocalSolanaKeypair(options.importSecret)).publicKey;
      } else if (options?.createNewKeypair) {
        pubkey = (await createLocalSolanaKeypair()).publicKey;
      } else {
        const stored = await getStoredLocalKeypair();
        if (!stored) {
          throw new Error('No saved local keypair found. Click Generate New Solana Keypair.');
        }
        pubkey = stored.publicKey.toBase58();
      }
      nextWallet = {
        connected: true,
        provider: 'keypair',
        providerLabel: 'Local Solana Keypair',
        address: pubkey,
        shortAddress: shortenAddress(pubkey),
        network,
        balances: {},
        canSign: true,
      };
    } else if (providerId === 'watch') {
      const addr = (options?.address ?? '').trim();
      if (!isValidSolanaPublicKey(addr)) {
        throw new Error('Enter a valid Base58 Solana public key to inspect.');
      }
      nextWallet = {
        connected: true,
        provider: 'watch',
        providerLabel: 'Watched Wallet',
        address: addr,
        shortAddress: shortenAddress(addr),
        network,
        balances: {},
        canSign: false,
      };
    } else {
      throw new Error('Unsupported wallet provider.');
    }

    setWallet(nextWallet);
    if (authUser && authUser.emailVerified) {
      void ensureUserWallet(authUser.uid, nextWallet);
    }
    await refreshWalletOnChain(nextWallet.address, nextWallet.network);
  };

  const handleDisconnectWallet = () => {
    const injected = getInjectedSolanaProvider(wallet.provider);
    if (injected?.disconnect) {
      void injected.disconnect().catch(() => {});
    }
    setWallet(DEFAULT_DISCONNECTED_WALLET);
    setWalletSnapshot(null);
  };

  const handleSwitchNetwork = (network: SolanaCluster) => {
    setWallet((prev) => ({ ...prev, network }));
    if (authUser && authUser.emailVerified) {
      void persistWalletNetwork(authUser.uid, network);
    }
  };

  // Record any real confirmed on-chain transaction (withdraw, burn, rent reclaim, devnet airdrop)
  const handleRecordOnChainTx = (tx: Omit<LedgerTransaction, 'id' | 'timestamp'>) => {
    if (!tx.txHash || tx.txHash.length < 64) return;
    if (authUser && authUser.emailVerified) {
      void persistOnChainTransaction(authUser.uid, tx);
    } else {
      const record: LedgerTransaction = {
        ...tx,
        id: `tx_${tx.txType.toLowerCase()}_${tx.txHash.slice(0, 18)}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        cluster: tx.cluster ?? wallet.network,
      };
      setTransactions((prev) => [record, ...prev]);
    }
  };

  // Real On-Chain SPL Token Launch callback
  const handleTokenLaunched = (
    token: SolanaToken,
    announcement: Announcement,
    solSpent: number,
    txSignature: string
  ) => {
    setSelectedTokenAddress(token.address);

    if (authUser && authUser.emailVerified) {
      void persistTokenLaunch(
        authUser.uid,
        token,
        announcement,
        solSpent,
        txSignature
      );
    } else {
      setLocalLaunchedTokens((prev) => [token, ...prev]);
      setLocalAnnouncements((prev) => [announcement, ...prev]);
      handleRecordOnChainTx({
        txType: 'LAUNCH',
        fromChain: 'solana',
        toChain: 'solana',
        fromSymbol: 'SOL',
        toSymbol: token.symbol,
        fromAmount: solSpent,
        toAmount: token.totalSupply ?? 0,
        feeSol: solSpent,
        priceImpactPct: 0,
        routeProvider: `Solana ${token.cluster || wallet.network} SPL Token Program`,
        summary: `Minted ${token.name} ($${token.symbol}) on-chain · Mint ${shortenAddress(token.address)}.`,
        mevProtected: true,
        txHash: txSignature,
        status: 'Confirmed',
        cluster: token.cluster ?? wallet.network,
        tokenAddress: token.address,
      });
    }

    void refreshWalletOnChain();
  };

  // Real On-Chain Jupiter v6 Swap callback
  const handleExecuteSwap = (record: SwapRecord) => {
    if (authUser && authUser.emailVerified) {
      void persistSwapExecution(authUser.uid, record);
    } else {
      handleRecordOnChainTx({
        txType: 'SWAP',
        fromChain: record.fromChain,
        toChain: record.toChain,
        fromSymbol: record.fromSymbol,
        toSymbol: record.toSymbol,
        fromAmount: record.fromAmount,
        toAmount: record.toAmount,
        feeSol: 0.0005,
        priceImpactPct: record.priceImpactPct,
        routeProvider: record.routeProvider,
        summary: `Swapped ${record.fromAmount} ${record.fromSymbol} → ${record.toAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${record.toSymbol} via Jupiter v6.`,
        mevProtected: record.mevProtected,
        txHash: record.txHash,
        status: 'Confirmed',
        cluster: wallet.network,
      });
    }
    void refreshWalletOnChain();
  };

  // X Tracker watch handler
  const handleAddXSignalWatch = (handle: string, cashtag: string) => {
    const cleanHandle = handle.replace(/^@/, '');
    const newSig: XTrackerSignal = {
      id: `xs_${Date.now()}`,
      handle: `@${cleanHandle}`,
      displayName: cleanHandle,
      verified: false,
      followersLabel: 'Custom Watch',
      cashtag,
      tokenName: `${cashtag} Token`,
      xUrl: `https://x.com/${encodeURIComponent(cleanHandle)}`,
      content: `Pinned live monitor for @${cleanHandle} tracking $${cashtag} on Solana.`,
      sentiment: 'Alert',
      likes: 0,
      reposts: 0,
      mentionsVelocity: 'Custom Watch',
      postedAt: new Date().toISOString(),
    };
    if (authUser && authUser.emailVerified) {
      void persistXSignalWatch(authUser.uid, newSig);
    } else {
      setLocalXSignals((prev) => [newSig, ...prev]);
    }
  };

  // Network Announcements handlers
  const handleAnnouncementCreated = (announcement: Announcement) => {
    if (authUser && authUser.emailVerified) {
      void persistAnnouncementCreate(authUser.uid, announcement);
    } else {
      setLocalAnnouncements((prev) => [announcement, ...prev]);
    }
  };

  const handleUpvoteAnnouncement = async (id: string) => {
    const target = announcements.find((a) => a.id === id);
    if (!target) return;

    if (authUser && authUser.emailVerified && target.persistedInDb) {
      void persistAnnouncementUpvote(id, target.upvotes);
      return;
    }

    setMarketAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, upvotes: a.upvotes + 1 } : a))
    );
    setLocalAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, upvotes: a.upvotes + 1 } : a))
    );
    try {
      await fetch(`/api/announcements/${id}/upvote`, { method: 'POST' });
    } catch {
      // Optimistic upvote preserved
    }
  };

  // Automated Alerts handlers
  const handleAddAlertRule = (
    tokenSymbol: string,
    metric: AlertMetric,
    threshold: number
  ) => {
    const newRule: AlertRule = {
      id: `rule_${Date.now()}`,
      tokenSymbol,
      metric,
      threshold,
      active: true,
      createdAt: new Date().toISOString(),
      triggeredCount: 0,
    };

    if (authUser && authUser.emailVerified) {
      const uid = authUser.uid;
      void persistAlertRuleCreate(uid, newRule).then(() => {
        runAlertEvaluation(tokens, [newRule, ...alertRulesRef.current]);
      });
    } else {
      const nextRules = [newRule, ...alertRules];
      setAlertRules(nextRules);
      runAlertEvaluation(tokens, nextRules);
    }
  };

  const handleToggleAlertRule = (id: string) => {
    const target = alertRules.find((r) => r.id === id);
    if (!target) return;
    if (authUser && authUser.emailVerified) {
      void persistAlertRuleToggle(authUser.uid, id, !target.active);
    } else {
      setAlertRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
      );
    }
  };

  const handleDeleteAlertRule = (id: string) => {
    if (authUser && authUser.emailVerified) {
      void persistAlertRuleDelete(authUser.uid, id);
    } else {
      setAlertRules((prev) => prev.filter((r) => r.id !== id));
    }
  };

  const handleAcknowledgeAllAlerts = () => {
    const unackedIds = triggeredAlerts
      .filter((a) => !a.acknowledged)
      .map((a) => a.id);
    if (unackedIds.length === 0) return;

    if (authUser && authUser.emailVerified) {
      void persistAcknowledgeAllAlerts(authUser.uid, unackedIds);
    } else {
      setTriggeredAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
    }
  };

  const inspectTokenBySymbol = (symbol: string) => {
    const match = tokens.find(
      (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (match) setSelectedTokenAddress(match.address);
    setActiveSection('gainer');
  };

  const unacknowledgedAlertsCount = triggeredAlerts.filter(
    (a) => !a.acknowledged
  ).length;
  const activeWalletAccountsCount =
    walletSnapshot?.tokenAccounts.filter((a) => !a.isEmpty).length ?? 0;
  const totalLedgerCount = useMemo(() => {
    const hashes = new Set<string>();
    for (const tx of transactions) {
      if (tx.txHash.length >= 64) hashes.add(tx.txHash);
    }
    for (const sig of walletSnapshot?.recentSignatures ?? []) {
      hashes.add(sig.signature);
    }
    return hashes.size;
  }, [transactions, walletSnapshot]);

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        unacknowledgedAlertsCount={unacknowledgedAlertsCount}
        announcementsCount={announcements.length}
        poolsCount={activeWalletAccountsCount}
        transactionsCount={totalLedgerCount}
        authUser={authUser}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeSection={activeSection}
          wallet={wallet}
          authUser={authUser}
          onOpenWalletModal={() => setWalletModalOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {activeSection === 'gainer' && (
            <TokenGainerView
              tokens={tokens}
              network={wallet.network}
              loading={tokensLoading}
              liveFeedConnected={liveFeedConnected}
              lastSyncedAt={lastSyncedAt}
              selectedTokenAddress={selectedTokenAddress}
              onSelectToken={setSelectedTokenAddress}
              onRefresh={fetchMarketData}
              onQuickTrade={(symbol) => {
                setPreselectedTradeSymbol(symbol);
                setActiveSection('trade');
              }}
              onQuickAlert={(symbol) => {
                setPreselectedAlertSymbol(symbol);
                setActiveSection('alerts');
              }}
              onQuickBoost={(address) => {
                setPreselectedBoostAddress(address);
                setActiveSection('launchpad');
              }}
            />
          )}

          {activeSection === 'launchpad' && (
            <LaunchBoostView
              tokens={tokens}
              wallet={wallet}
              preselectedBoostAddress={preselectedBoostAddress}
              clonedTrendingCoin={clonedTrendingCoin}
              onClearClonedCoin={() => setClonedTrendingCoin(null)}
              onRequireWallet={() => setWalletModalOpen(true)}
              onTokenLaunched={handleTokenLaunched}
              onInspectLaunchedToken={(address) => {
                setSelectedTokenAddress(address);
                setActiveSection('gainer');
              }}
              onCreatePoolForToken={() => setActiveSection('liquidity')}
            />
          )}

          {activeSection === 'liquidity' && (
            <ManageLiquidityView
              tokens={tokens}
              wallet={wallet}
              walletSnapshot={walletSnapshot}
              walletLoading={walletLoading}
              onRequireWallet={() => setWalletModalOpen(true)}
              onRefreshWallet={() => refreshWalletOnChain()}
              onRecordOnChainTx={handleRecordOnChainTx}
            />
          )}

          {activeSection === 'trade' && (
            <MultiChainTradeView
              tokens={tokens}
              wallet={wallet}
              walletSnapshot={walletSnapshot}
              walletLoading={walletLoading}
              swapHistory={swapHistory}
              preselectedSymbol={preselectedTradeSymbol}
              onOpenWalletModal={() => setWalletModalOpen(true)}
              onRefreshWallet={() => refreshWalletOnChain()}
              onExecuteSwap={handleExecuteSwap}
              onRecordOnChainTx={handleRecordOnChainTx}
            />
          )}

          {activeSection === 'transactions' && (
            <TransactionsView
              transactions={transactions}
              walletSnapshot={walletSnapshot}
              walletLoading={walletLoading}
              tokens={tokens}
              network={wallet.network}
              authUser={authUser}
              walletConnected={wallet.connected}
              onSignInGoogle={handleSignInGoogle}
              onOpenWalletModal={() => setWalletModalOpen(true)}
              onRefreshOnChain={() => refreshWalletOnChain()}
            />
          )}

          {activeSection === 'xtracker' && (
            <XTrackerView
              signals={xSignals}
              tokens={tokens}
              network={wallet.network}
              onCopyToLaunchpad={(coin) => {
                setClonedTrendingCoin(coin);
                setActiveSection('launchpad');
              }}
              onInspectTokenBySymbol={inspectTokenBySymbol}
              onQuickTrade={(symbol) => {
                setPreselectedTradeSymbol(symbol);
                setActiveSection('trade');
              }}
              onAddSignalWatch={handleAddXSignalWatch}
            />
          )}

          {activeSection === 'announcements' && (
            <AnnouncementsView
              announcements={announcements}
              tokens={tokens}
              wallet={wallet}
              onAnnouncementCreated={handleAnnouncementCreated}
              onUpvote={handleUpvoteAnnouncement}
              onInspectTokenBySymbol={inspectTokenBySymbol}
            />
          )}

          {activeSection === 'alerts' && (
            <AlertsView
              tokens={tokens}
              network={wallet.network}
              rules={alertRules}
              triggered={triggeredAlerts}
              preselectedSymbol={preselectedAlertSymbol}
              onAddRule={handleAddAlertRule}
              onToggleRule={handleToggleAlertRule}
              onDeleteRule={handleDeleteAlertRule}
              onAcknowledgeAll={handleAcknowledgeAllAlerts}
              onEvaluateNow={() => runAlertEvaluation(tokens)}
            />
          )}
        </main>
      </div>

      <WalletModal
        open={walletModalOpen}
        wallet={wallet}
        walletSnapshot={walletSnapshot}
        walletLoading={walletLoading}
        authUser={authUser}
        onClose={() => setWalletModalOpen(false)}
        onConnect={handleConnectWallet}
        onDisconnect={handleDisconnectWallet}
        onSwitchNetwork={handleSwitchNetwork}
        onRefreshOnChain={() => refreshWalletOnChain()}
        onRecordOnChainTx={handleRecordOnChainTx}
        onSignInGoogle={handleSignInGoogle}
        onSignOutGoogle={handleSignOutGoogle}
      />
    </div>
  );
}
