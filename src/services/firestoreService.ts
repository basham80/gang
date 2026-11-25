import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  AlertRule,
  Announcement,
  LedgerTransaction,
  LiquidityPool,
  SolanaCluster,
  SolanaToken,
  SwapRecord,
  TriggeredAlert,
  WalletState,
  XTrackerSignal,
} from '../types/solana';
import { shortenAddress } from '../utils/solanaLogic';
import { isValidSolanaPublicKey } from '../utils/solanaRpc';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  return new Date().toISOString();
}

export function sanitizeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
}

function clampString(val: string | undefined, maxLen: number): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function sanitizeBalances(balances: Record<string, number>): Record<string, number> {
  const clean: Record<string, number> = {
    SOL: Math.max(0, Number((balances.SOL ?? 0).toFixed(6))),
  };
  let count = 1;
  for (const [k, v] of Object.entries(balances)) {
    if (k === 'SOL' || count >= 40) continue;
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0 && k.length > 0 && k.length <= 24) {
      clean[k] = Number(num.toFixed(6));
      count += 1;
    }
  }
  return clean;
}

function buildTokenFirestorePayload(uid: string, token: SolanaToken) {
  const sparkline =
    Array.isArray(token.sparkline) && token.sparkline.length >= 2
      ? token.sparkline.slice(0, 24).map((n) => (Number.isFinite(n) ? n : token.priceUsd))
      : [token.priceUsd, token.priceUsd];

  const payload: Record<string, unknown> = {
    ownerId: uid,
    visibility: 'public',
    address: token.address.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64),
    symbol: token.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
    name: token.name.trim().slice(0, 48),
    category: token.category,
    priceUsd: Math.max(0, Number(token.priceUsd) || 0),
    change5m: Math.max(-100, Math.min(100000, Number(token.change5m) || 0)),
    change1h: Math.max(-100, Math.min(100000, Number(token.change1h) || 0)),
    change24h: Math.max(-100, Math.min(100000, Number(token.change24h) || 0)),
    volume24h: Math.max(0, Number(token.volume24h) || 0),
    liquidityUsd: Math.max(0, Number(token.liquidityUsd) || 0),
    marketCap: Math.max(0, Number(token.marketCap) || 0),
    holders: Math.max(0, Number(token.holders) || 1),
    ageHours: Math.max(0, Number(token.ageHours) || 0.1),
    boostMultiplier: Math.max(1, Math.min(100, Number(token.boostMultiplier) || 1)),
    boostTier: token.boostTier || 'none',
    verifiedDev: Boolean(token.verifiedDev),
    security: {
      mintRevoked: Boolean(token.security.mintRevoked),
      freezeRevoked: Boolean(token.security.freezeRevoked),
      lpLockedMonths: Math.max(0, Math.min(120, Number(token.security.lpLockedMonths) || 0)),
      metadataImmutable: Boolean(token.security.metadataImmutable),
    },
    sparkline,
    description:
      token.description.trim().length >= 10
        ? token.description.trim().slice(0, 500)
        : `${token.name} SPL token deployed on Solana via YABBAI Launch Pad.`.slice(0, 500),
    decimals: Math.max(0, Math.min(9, Math.round(Number(token.decimals ?? 9)))),
    totalSupply: Math.max(
      1000,
      Math.min(1_000_000_000_000_000, Number(token.totalSupply ?? 1_000_000_000))
    ),
    launchedByUser: Boolean(token.launchedByUser),
    dexSource: (token.dexSource || 'Solana SPL').slice(0, 64),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (token.imageUrl && token.imageUrl.length <= 70000) {
    payload.imageUrl = token.imageUrl;
  }
  const creatorName = clampString(token.creatorName, 64);
  if (creatorName) payload.creatorName = creatorName;
  const creatorWebsite = clampString(token.creatorWebsite, 200);
  if (creatorWebsite) payload.creatorWebsite = creatorWebsite;
  const website = clampString(token.socials?.website, 200);
  if (website) payload.website = website;
  const twitter = clampString(token.socials?.twitter, 200);
  if (twitter) payload.twitter = twitter;
  const telegram = clampString(token.socials?.telegram, 200);
  if (telegram) payload.telegram = telegram;
  const discord = clampString(token.socials?.discord, 200);
  if (discord) payload.discord = discord;
  const pairAddress = clampString(token.pairAddress, 64);
  if (pairAddress) payload.pairAddress = pairAddress;
  const dexUrl = clampString(token.dexUrl, 240);
  if (dexUrl) payload.dexUrl = dexUrl;
  const txSignature = clampString(token.txSignature, 100);
  if (txSignature) payload.txSignature = txSignature;
  const cluster = clampString(token.cluster, 20);
  if (cluster) payload.cluster = cluster;

  return payload;
}

function buildAnnouncementPayload(uid: string, announcement: Announcement) {
  const payload: Record<string, unknown> = {
    authorUid: uid,
    visibility: 'public',
    category: announcement.category,
    title: announcement.title.trim().slice(0, 140),
    body: announcement.body.trim().slice(0, 800),
    author: (announcement.author || 'YABBAI Builder').trim().slice(0, 64),
    walletAddress: (announcement.walletAddress || 'Solana').trim().slice(0, 64),
    verified: Boolean(announcement.verified),
    upvotes: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const sym = clampString(announcement.tokenSymbol, 12);
  if (sym) payload.tokenSymbol = sym.toUpperCase();
  return payload;
}

function buildTxPayload(
  uid: string,
  tx: Omit<LedgerTransaction, 'id' | 'timestamp'>
) {
  return {
    ownerId: uid,
    txType: tx.txType,
    fromChain: tx.fromChain,
    toChain: tx.toChain,
    fromSymbol: tx.fromSymbol.slice(0, 20),
    toSymbol: tx.toSymbol.slice(0, 20),
    fromAmount: Math.max(0, Number(tx.fromAmount) || 0),
    toAmount: Math.max(0, Number(tx.toAmount) || 0),
    feeSol: Math.max(0, Number(tx.feeSol) || 0),
    priceImpactPct: Math.max(0, Math.min(100, Number(tx.priceImpactPct) || 0)),
    routeProvider: tx.routeProvider.slice(0, 64),
    summary: tx.summary.slice(0, 240),
    mevProtected: Boolean(tx.mevProtected),
    txHash: tx.txHash.replace(/[^a-zA-Z0-9]/g, '').slice(0, 88),
    status: 'Confirmed',
    createdAt: serverTimestamp(),
  };
}

// ---------- Real-Time Public Subscriptions ----------

export function subscribePublicTokens(
  onData: (tokens: SolanaToken[]) => void
): Unsubscribe {
  const q = query(collection(db, 'tokens'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Array<{ token: SolanaToken; createdMs: number }> = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const address = String(d.address || docSnap.id);
        // Only surface tokens with a confirmed real on-chain txSignature (filters out any legacy pre-onchain records)
        const txSignature =
          typeof d.txSignature === 'string' && d.txSignature.length >= 64
            ? d.txSignature
            : undefined;
        if (!txSignature || !isValidSolanaPublicKey(address)) {
          return;
        }
        const createdIso = toIsoString(d.createdAt);
        items.push({
          createdMs: new Date(createdIso).getTime(),
          token: {
            address,
            symbol: String(d.symbol || 'SPL'),
            name: String(d.name || 'Solana Token'),
            category: d.category || 'Meme',
            priceUsd: Number(d.priceUsd) || 0,
            change5m: Number(d.change5m) || 0,
            change1h: Number(d.change1h) || 0,
            change24h: Number(d.change24h) || 0,
            volume24h: Number(d.volume24h) || 0,
            liquidityUsd: Number(d.liquidityUsd) || 0,
            marketCap: Number(d.marketCap) || 0,
            holders: Number(d.holders) || 1,
            ageHours: Number(d.ageHours) || 0.1,
            boostMultiplier: Number(d.boostMultiplier) || 1,
            boostTier: d.boostTier || 'none',
            verifiedDev: Boolean(d.verifiedDev),
            security: {
              mintRevoked: Boolean(d.security?.mintRevoked),
              freezeRevoked: Boolean(d.security?.freezeRevoked),
              lpLockedMonths: Number(d.security?.lpLockedMonths) || 0,
              metadataImmutable: Boolean(d.security?.metadataImmutable),
            },
            sparkline: Array.isArray(d.sparkline) ? d.sparkline.map(Number) : [0, 0],
            description: String(d.description || ''),
            decimals: Number(d.decimals ?? 9),
            totalSupply: Number(d.totalSupply ?? 1_000_000_000),
            imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : undefined,
            socials: {
              website: typeof d.website === 'string' ? d.website : undefined,
              twitter: typeof d.twitter === 'string' ? d.twitter : undefined,
              telegram: typeof d.telegram === 'string' ? d.telegram : undefined,
              discord: typeof d.discord === 'string' ? d.discord : undefined,
            },
            creatorName: typeof d.creatorName === 'string' ? d.creatorName : undefined,
            creatorWebsite:
              typeof d.creatorWebsite === 'string' ? d.creatorWebsite : undefined,
            launchedByUser: Boolean(d.launchedByUser),
            dexSource: String(d.dexSource || 'Solana SPL'),
            pairAddress: typeof d.pairAddress === 'string' ? d.pairAddress : undefined,
            dexUrl: typeof d.dexUrl === 'string' ? d.dexUrl : undefined,
            txSignature,
            cluster: d.cluster === 'Devnet' ? 'Devnet' : 'Mainnet-Beta',
            onChainVerified: true,
            persistedInDb: true,
          },
        });
      });
      items.sort((a, b) => b.createdMs - a.createdMs);
      onData(items.map((i) => i.token));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tokens');
    }
  );
}

export function subscribePublicAnnouncements(
  onData: (announcements: Announcement[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'announcements'),
    where('visibility', '==', 'public')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Announcement[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: docSnap.id,
          category: d.category || 'Network',
          title: String(d.title || ''),
          body: String(d.body || ''),
          tokenSymbol: typeof d.tokenSymbol === 'string' ? d.tokenSymbol : undefined,
          author: String(d.author || 'YABBAI'),
          walletAddress: String(d.walletAddress || 'Solana'),
          verified: Boolean(d.verified),
          createdAt: toIsoString(d.createdAt),
          upvotes: Number(d.upvotes) || 1,
          persistedInDb: true,
        });
      });
      items.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'announcements');
    }
  );
}

export function subscribePublicXSignals(
  onData: (signals: XTrackerSignal[]) => void
): Unsubscribe {
  const q = query(collection(db, 'xSignals'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: XTrackerSignal[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: docSnap.id,
          handle: String(d.handle || '@solana'),
          displayName: String(d.displayName || 'Solana Watch'),
          verified: Boolean(d.verified),
          followersLabel: String(d.followersLabel || 'Live Watch'),
          cashtag: String(d.cashtag || 'SOL'),
          tokenName: String(d.tokenName || 'Solana'),
          content: String(d.content || ''),
          sentiment: d.sentiment || 'Alert',
          likes: Number(d.likes) || 0,
          reposts: Number(d.reposts) || 0,
          mentionsVelocity: String(d.mentionsVelocity || 'Monitoring active'),
          postedAt: toIsoString(d.createdAt),
        });
      });
      items.sort(
        (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
      );
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'xSignals');
    }
  );
}

// ---------- Real-Time Private Per-User Subscriptions ----------

export function subscribeUserWallet(
  uid: string,
  onData: (wallet: WalletState | null) => void
): Unsubscribe {
  const path = `users/${uid}/profile/wallet`;
  return onSnapshot(
    doc(db, 'users', uid, 'profile', 'wallet'),
    (docSnap) => {
      if (!docSnap.exists()) {
        onData(null);
        return;
      }
      const d = docSnap.data();
      const address = String(d.address || '');
      const provider = d.provider;
      // Ignore legacy sandbox wallet docs — only restore real Solana public keys
      if (
        !address ||
        !isValidSolanaPublicKey(address) ||
        provider === 'sandbox'
      ) {
        onData(null);
        return;
      }
      const rawBalances = (d.balances ?? {}) as Record<string, unknown>;
      const balances: Record<string, number> = {};
      for (const [k, v] of Object.entries(rawBalances)) {
        const num = Number(v);
        if (Number.isFinite(num)) balances[k] = num;
      }
      onData({
        connected: true,
        provider,
        providerLabel: String(d.providerLabel || 'Solana Wallet'),
        address,
        shortAddress: String(d.shortAddress || shortenAddress(address)),
        network: d.network === 'Devnet' ? 'Devnet' : 'Mainnet-Beta',
        balances,
        canSign: provider !== 'watch',
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeUserPools(
  uid: string,
  onData: (pools: LiquidityPool[]) => void
): Unsubscribe {
  const path = `users/${uid}/pools`;
  const q = query(collection(db, 'users', uid, 'pools'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LiquidityPool[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: docSnap.id,
          dex: d.dex === 'Meteora' ? 'Meteora' : 'Raydium',
          tokenAddress: String(d.tokenAddress || ''),
          tokenSymbol: String(d.tokenSymbol || ''),
          tokenName: String(d.tokenName || ''),
          quoteSymbol: d.quoteSymbol === 'USDC' ? 'USDC' : 'SOL',
          baseAmount: Number(d.baseAmount) || 0,
          quoteAmount: Number(d.quoteAmount) || 0,
          initialPriceUsd: Number(d.initialPriceUsd) || 0,
          tvlUsd: Number(d.tvlUsd) || 0,
          feeTierPct: Number(d.feeTierPct) || 0.25,
          lpTokens: Number(d.lpTokens) || 0,
          lpLockedLabel: String(d.lpLockedLabel || 'On-Chain Pool'),
          lpBurned: Boolean(d.lpBurned),
          createdAt: toIsoString(d.createdAt),
        });
      });
      items.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeUserTransactions(
  uid: string,
  onData: (transactions: LedgerTransaction[]) => void
): Unsubscribe {
  const path = `users/${uid}/transactions`;
  const q = query(
    collection(db, 'users', uid, 'transactions'),
    where('ownerId', '==', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LedgerTransaction[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const txHash = String(d.txHash || '');
        // Only surface transactions with real Solana 80+ char signatures
        if (txHash.length < 64) return;
        items.push({
          id: docSnap.id,
          txType: d.txType || 'SWAP',
          fromChain: d.fromChain || 'solana',
          toChain: d.toChain || 'solana',
          fromSymbol: String(d.fromSymbol || 'SOL'),
          toSymbol: String(d.toSymbol || 'USDC'),
          fromAmount: Number(d.fromAmount) || 0,
          toAmount: Number(d.toAmount) || 0,
          feeSol: Number(d.feeSol) || 0,
          priceImpactPct: Number(d.priceImpactPct) || 0,
          routeProvider: String(d.routeProvider || 'Solana RPC'),
          summary: String(d.summary || ''),
          mevProtected: Boolean(d.mevProtected),
          txHash,
          status: 'Confirmed',
          timestamp: toIsoString(d.createdAt),
        });
      });
      items.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeUserAlertRules(
  uid: string,
  onData: (rules: AlertRule[]) => void
): Unsubscribe {
  const path = `users/${uid}/alertRules`;
  const q = query(
    collection(db, 'users', uid, 'alertRules'),
    where('ownerId', '==', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: AlertRule[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: docSnap.id,
          tokenSymbol: String(d.tokenSymbol || 'SOL'),
          metric: d.metric || 'price_above',
          threshold: Number(d.threshold) || 0,
          active: Boolean(d.active),
          createdAt: toIsoString(d.createdAt),
          triggeredCount: Number(d.triggeredCount) || 0,
          lastTriggeredAt:
            typeof d.lastTriggeredAt === 'string' ? d.lastTriggeredAt : undefined,
        });
      });
      items.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeUserTriggeredAlerts(
  uid: string,
  onData: (alerts: TriggeredAlert[]) => void
): Unsubscribe {
  const path = `users/${uid}/triggeredAlerts`;
  const q = query(
    collection(db, 'users', uid, 'triggeredAlerts'),
    where('ownerId', '==', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: TriggeredAlert[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: docSnap.id,
          ruleId: String(d.ruleId || ''),
          tokenSymbol: String(d.tokenSymbol || 'SOL'),
          message: String(d.message || ''),
          currentValue: Number(d.currentValue) || 0,
          triggeredAt: toIsoString(d.createdAt),
          acknowledged: Boolean(d.acknowledged),
        });
      });
      items.sort(
        (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
      );
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// ---------- Atomic Persistence for Real On-Chain Operations ----------

export async function ensureUserWallet(
  uid: string,
  wallet: WalletState
): Promise<void> {
  if (!wallet.address || !isValidSolanaPublicKey(wallet.address)) return;
  const walletRef = doc(db, 'users', uid, 'profile', 'wallet');
  const path = `users/${uid}/profile/wallet`;
  try {
    const existingSnap = await getDoc(walletRef);
    const provider = wallet.provider || 'watch';
    if (!existingSnap.exists()) {
      await setDoc(walletRef, {
        ownerId: uid,
        provider,
        providerLabel: (wallet.providerLabel || 'Solana Wallet').slice(0, 48),
        address: wallet.address.slice(0, 64),
        shortAddress: wallet.shortAddress.slice(0, 24),
        network: wallet.network,
        balances: sanitizeBalances(wallet.balances),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(walletRef, {
        provider,
        providerLabel: (wallet.providerLabel || 'Solana Wallet').slice(0, 48),
        address: wallet.address.slice(0, 64),
        shortAddress: wallet.shortAddress.slice(0, 24),
        network: wallet.network,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistWalletOnChainBalances(
  uid: string,
  balances: Record<string, number>
): Promise<void> {
  const walletRef = doc(db, 'users', uid, 'profile', 'wallet');
  const path = `users/${uid}/profile/wallet`;
  try {
    const snap = await getDoc(walletRef);
    if (!snap.exists()) return;
    await updateDoc(walletRef, {
      balances: sanitizeBalances(balances),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function persistWalletNetwork(
  uid: string,
  network: SolanaCluster
): Promise<void> {
  const walletRef = doc(db, 'users', uid, 'profile', 'wallet');
  const path = `users/${uid}/profile/wallet`;
  try {
    const snap = await getDoc(walletRef);
    if (!snap.exists()) return;
    await updateDoc(walletRef, {
      network,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function persistTokenLaunch(
  uid: string,
  token: SolanaToken,
  announcement: Announcement,
  solSpent: number,
  txSignature: string
): Promise<void> {
  const batch = writeBatch(db);
  const tokenId = sanitizeDocId(token.address);
  const tokenRef = doc(db, 'tokens', tokenId);
  batch.set(
    tokenRef,
    buildTokenFirestorePayload(uid, { ...token, address: tokenId, txSignature })
  );

  const annId = sanitizeDocId(announcement.id);
  const annRef = doc(db, 'announcements', annId);
  batch.set(annRef, buildAnnouncementPayload(uid, announcement));

  const txId = sanitizeDocId(`tx_launch_${txSignature.slice(0, 20)}`);
  const txRef = doc(db, 'users', uid, 'transactions', txId);
  batch.set(
    txRef,
    buildTxPayload(uid, {
      txType: 'LAUNCH',
      fromChain: 'solana',
      toChain: 'solana',
      fromSymbol: 'SOL',
      toSymbol: token.symbol,
      fromAmount: solSpent,
      toAmount: token.totalSupply ?? 0,
      feeSol: solSpent,
      priceImpactPct: 0,
      routeProvider: `Solana ${token.cluster || 'Mainnet-Beta'} SPL Token Program`,
      summary: `Minted ${token.name} ($${token.symbol}) on-chain · Mint ${shortenAddress(token.address)}.`,
      mevProtected: true,
      txHash: txSignature,
      status: 'Confirmed',
    })
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tokens/${tokenId}`);
  }
}

export async function persistOnChainTransaction(
  uid: string,
  tx: Omit<LedgerTransaction, 'id' | 'timestamp'>
): Promise<void> {
  const txId = sanitizeDocId(
    `tx_${tx.txType.toLowerCase()}_${tx.txHash.slice(0, 20)}_${Date.now()}`
  );
  try {
    await setDoc(
      doc(db, 'users', uid, 'transactions', txId),
      buildTxPayload(uid, tx)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `users/${uid}/transactions/${txId}`
    );
  }
}

export async function persistSwapExecution(
  uid: string,
  record: SwapRecord
): Promise<void> {
  await persistOnChainTransaction(uid, {
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
  });
}

export async function persistAnnouncementCreate(
  uid: string,
  announcement: Announcement
): Promise<void> {
  const id = sanitizeDocId(announcement.id);
  try {
    await setDoc(doc(db, 'announcements', id), buildAnnouncementPayload(uid, announcement));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `announcements/${id}`);
  }
}

export async function persistAnnouncementUpvote(
  id: string,
  currentUpvotes: number
): Promise<void> {
  const safeId = sanitizeDocId(id);
  try {
    await updateDoc(doc(db, 'announcements', safeId), {
      upvotes: currentUpvotes + 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `announcements/${safeId}`);
  }
}

export async function persistXSignalWatch(
  uid: string,
  signal: XTrackerSignal
): Promise<void> {
  const id = sanitizeDocId(signal.id);
  try {
    await setDoc(doc(db, 'xSignals', id), {
      ownerId: uid,
      visibility: 'public',
      handle: signal.handle.slice(0, 40),
      displayName: signal.displayName.slice(0, 48),
      verified: Boolean(signal.verified),
      followersLabel: signal.followersLabel.slice(0, 32),
      cashtag: signal.cashtag.slice(0, 12),
      tokenName: signal.tokenName.slice(0, 48),
      content: signal.content.slice(0, 400),
      sentiment: signal.sentiment,
      likes: Math.max(0, signal.likes),
      reposts: Math.max(0, signal.reposts),
      mentionsVelocity: signal.mentionsVelocity.slice(0, 48),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `xSignals/${id}`);
  }
}

export async function persistAlertRuleCreate(
  uid: string,
  rule: AlertRule
): Promise<void> {
  const id = sanitizeDocId(rule.id);
  try {
    await setDoc(doc(db, 'users', uid, 'alertRules', id), {
      ownerId: uid,
      tokenSymbol: rule.tokenSymbol.slice(0, 12),
      metric: rule.metric,
      threshold: rule.threshold,
      active: Boolean(rule.active),
      triggeredCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${uid}/alertRules/${id}`);
  }
}

export async function persistAlertRuleToggle(
  uid: string,
  ruleId: string,
  nextActive: boolean
): Promise<void> {
  const id = sanitizeDocId(ruleId);
  try {
    await updateDoc(doc(db, 'users', uid, 'alertRules', id), {
      active: nextActive,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/alertRules/${id}`);
  }
}

export async function persistAlertRuleDelete(
  uid: string,
  ruleId: string
): Promise<void> {
  const id = sanitizeDocId(ruleId);
  try {
    await deleteDoc(doc(db, 'users', uid, 'alertRules', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}/alertRules/${id}`);
  }
}

export async function persistTriggeredAlerts(
  uid: string,
  newlyTriggered: TriggeredAlert[],
  updatedRules: AlertRule[]
): Promise<void> {
  if (newlyTriggered.length === 0) return;
  const batch = writeBatch(db);
  const touchedRuleIds = new Set(newlyTriggered.map((t) => t.ruleId));

  for (const alert of newlyTriggered) {
    const id = sanitizeDocId(alert.id);
    batch.set(doc(db, 'users', uid, 'triggeredAlerts', id), {
      ownerId: uid,
      ruleId: sanitizeDocId(alert.ruleId),
      tokenSymbol: alert.tokenSymbol.slice(0, 12),
      message: alert.message.slice(0, 240),
      currentValue: alert.currentValue,
      acknowledged: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const rule of updatedRules) {
    if (!touchedRuleIds.has(rule.id)) continue;
    const id = sanitizeDocId(rule.id);
    batch.update(doc(db, 'users', uid, 'alertRules', id), {
      triggeredCount: rule.triggeredCount,
      lastTriggeredAt: rule.lastTriggeredAt ?? new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}/triggeredAlerts`);
  }
}

export async function persistAcknowledgeAllAlerts(
  uid: string,
  unacknowledgedIds: string[]
): Promise<void> {
  if (unacknowledgedIds.length === 0) return;
  const batch = writeBatch(db);
  for (const rawId of unacknowledgedIds) {
    const id = sanitizeDocId(rawId);
    batch.update(doc(db, 'users', uid, 'triggeredAlerts', id), {
      acknowledged: true,
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/triggeredAlerts`);
  }
}
