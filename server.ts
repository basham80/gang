import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { CANONICAL_SOLANA_MINTS } from './src/data/seedData';
import type {
  Announcement,
  AnnouncementCategory,
  OnChainHolderInfo,
  OnChainTokenInspection,
  PersonalizedBrief,
  RiskProfile,
  SentimentAnalysis,
  SolanaChainState,
  SolanaCluster,
  SolanaToken,
  TrendingCoin,
  WalletOnChainSnapshot,
  XTrackerSignal,
} from './src/types/solana';
import {
  SOL_MINT_ADDRESS,
  shortenAddress,
} from './src/utils/solanaLogic';
import {
  fromRawTokenAmount,
  isValidSolanaPublicKey,
  lamportsToSol,
  mapDexPairsToPools,
  mapDexPairToSolanaToken,
  mapDexPairToTrendingCoin,
  parseJupiterQuoteResponse,
  parseMintAccountJsonParsed,
  parseRpcTokenAccounts,
  sanitizeExternalUrl,
  selectBestSolanaPair,
  type ParsedMintAuthorityState,
  type RawDexScreenerPair,
  type RawRpcTokenAccountItem,
} from './src/utils/solanaRpc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const MAINNET_RPC_ENDPOINTS = [
  process.env.SOLANA_MAINNET_RPC_URL?.trim(),
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
].filter((u): u is string => Boolean(u && /^https?:\/\//.test(u)));

const DEVNET_RPC_ENDPOINTS = [
  process.env.SOLANA_DEVNET_RPC_URL?.trim(),
  'https://api.devnet.solana.com',
].filter((u): u is string => Boolean(u && /^https?:\/\//.test(u)));

const ALLOWED_RPC_METHODS = new Set([
  'getLatestBlockhash',
  'getBalance',
  'getAccountInfo',
  'getMultipleAccounts',
  'getTokenAccountsByOwner',
  'getTokenLargestAccounts',
  'getSignaturesForAddress',
  'getTransaction',
  'getSlot',
  'getBlockHeight',
  'getEpochInfo',
  'getRecentPerformanceSamples',
  'getMinimumBalanceForRentExemption',
  'simulateTransaction',
  'sendTransaction',
  'getSignatureStatuses',
  'getFeeForMessage',
  'getTokenSupply',
  'getTokenAccountBalance',
  'getRecentPrioritizationFees',
  'isBlockhashValid',
]);

// Live-only in-memory caches (zero synthetic/fake data)
let liveTokensCache: SolanaToken[] = [];
let liveTokensCacheAt = 0;
let liveTrendingCache: TrendingCoin[] = [];
let liveTrendingCacheAt = 0;
let liveXSignalsCache: XTrackerSignal[] = [];
let liveFeedConnected = false;

// Real on-chain verified tokens registered during this server session
const verifiedSessionTokens = new Map<string, SolanaToken>();
// Real announcements created by verified on-chain events or user broadcasts
let announcementsRegistry: Announcement[] = [];

function normalizeCluster(raw: unknown): SolanaCluster {
  return raw === 'Devnet' ? 'Devnet' : 'Mainnet-Beta';
}

async function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 7000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function solanaRpcCall<T = unknown>(
  cluster: SolanaCluster,
  method: string,
  params: unknown[] = []
): Promise<{ result: T; endpoint: string }> {
  const endpoints =
    cluster === 'Devnet' ? DEVNET_RPC_ENDPOINTS : MAINNET_RPC_ENDPOINTS;

  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJsonWithTimeout<{
        result?: T;
        error?: { code?: number; message?: string };
      }>(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
          }),
        },
        8000
      );

      if (data.error) {
        lastError = new Error(data.error.message || `RPC error ${data.error.code}`);
        // Don't retry client/simulation errors across nodes
        if (method === 'sendTransaction' || method === 'simulateTransaction') {
          throw lastError;
        }
        continue;
      }

      return { result: data.result as T, endpoint };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Solana RPC call failed');
      if (method === 'sendTransaction' || method === 'simulateTransaction') {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error(`All Solana ${cluster} RPC endpoints failed.`);
}

async function fetchDexPairsForAddresses(
  addresses: string[]
): Promise<RawDexScreenerPair[]> {
  const unique = [...new Set(addresses.filter(isValidSolanaPublicKey))];
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 28) {
    chunks.push(unique.slice(i, i + 28));
  }

  const allPairs: RawDexScreenerPair[] = [];
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const payload = await fetchJsonWithTimeout<{ pairs?: RawDexScreenerPair[] }>(
          `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
          {},
          6500
        );
        if (Array.isArray(payload.pairs)) {
          allPairs.push(...payload.pairs);
        }
      } catch {
        // Individual chunk failure tolerated
      }
    })
  );
  return allPairs;
}

async function fetchLiveBoostedSolanaAddresses(): Promise<
  Array<{ address: string; description?: string }>
> {
  const collected = new Map<string, string | undefined>();
  const endpoints = [
    'https://api.dexscreener.com/token-boosts/top/v1',
    'https://api.dexscreener.com/token-profiles/latest/v1',
  ];

  await Promise.all(
    endpoints.map(async (url) => {
      try {
        const list = await fetchJsonWithTimeout<
          Array<{ chainId?: string; tokenAddress?: string; description?: string }>
        >(url, {}, 5500);
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (
            item?.chainId === 'solana' &&
            typeof item.tokenAddress === 'string' &&
            isValidSolanaPublicKey(item.tokenAddress)
          ) {
            if (!collected.has(item.tokenAddress)) {
              collected.set(item.tokenAddress, item.description);
            }
          }
        }
      } catch {
        // Ignore transient boost endpoint issues
      }
    })
  );

  return [...collected.entries()].map(([address, description]) => ({
    address,
    description,
  }));
}

async function fetchMintAuthoritiesBatch(
  addresses: string[]
): Promise<Map<string, ParsedMintAuthorityState>> {
  const map = new Map<string, ParsedMintAuthorityState>();
  const valid = [...new Set(addresses.filter(isValidSolanaPublicKey))].slice(0, 60);
  if (valid.length === 0) return map;

  try {
    const { result } = await solanaRpcCall<{ value?: unknown[] }>(
      'Mainnet-Beta',
      'getMultipleAccounts',
      [valid, { encoding: 'jsonParsed', commitment: 'confirmed' }]
    );
    const values = Array.isArray(result?.value) ? result.value : [];
    for (let i = 0; i < valid.length; i += 1) {
      map.set(valid[i], parseMintAccountJsonParsed(values[i]));
    }
  } catch {
    // RPC batch fallback: leave unverified rather than faking
  }
  return map;
}

function buildLiveXSignalsFromPairs(
  pairs: RawDexScreenerPair[]
): XTrackerSignal[] {
  const signals: XTrackerSignal[] = [];
  const seenHandles = new Set<string>();

  for (const p of pairs) {
    const twitterObj = p.info?.socials?.find(
      (s) => s.type?.toLowerCase() === 'twitter' || s.type?.toLowerCase() === 'x'
    );
    const cleanUrl = sanitizeExternalUrl(twitterObj?.url);
    if (!cleanUrl) continue;

    const match = cleanUrl.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,30})/i);
    const handle = match ? `@${match[1]}` : null;
    if (!handle || seenHandles.has(handle.toLowerCase())) continue;
    seenHandles.add(handle.toLowerCase());

    const symbol = (p.baseToken?.symbol ?? 'SPL').toUpperCase().slice(0, 12);
    const name = (p.baseToken?.name ?? symbol).slice(0, 48);
    const change1h = Number(p.priceChange?.h1 ?? 0);
    const change24h = Number(p.priceChange?.h24 ?? 0);
    const vol24h = Number(p.volume?.h24 ?? 0);
    const liqUsd = Number(p.liquidity?.usd ?? 0);
    const buys1h = Number(p.txns?.h1?.buys ?? 0);
    const sells1h = Number(p.txns?.h1?.sells ?? 0);

    const sentiment: XTrackerSignal['sentiment'] =
      change1h >= 5 || change24h >= 10
        ? 'Bullish'
        : buys1h >= 40
          ? 'Alert'
          : 'Neutral';

    signals.push({
      id: `live-x-${p.baseToken?.address ?? signals.length}`,
      handle,
      displayName: `${name} Official`,
      verified: true,
      followersLabel: `${(p.dexId ?? 'Solana').toUpperCase()} Pair`,
      cashtag: symbol,
      tokenName: name,
      tokenAddress: p.baseToken?.address,
      pairAddress: p.pairAddress,
      xUrl: cleanUrl,
      content: `Live on-chain market for $${symbol} on ${(p.dexId ?? 'Solana DEX').toUpperCase()}: 24h change ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%, 24h volume $${Math.round(vol24h).toLocaleString('en-US')}, pool liquidity $${Math.round(liqUsd).toLocaleString('en-US')}.`,
      sentiment,
      likes: buys1h,
      reposts: sells1h,
      mentionsVelocity: `${buys1h} buys / ${sells1h} sells (1h)`,
      postedAt: p.pairCreatedAt
        ? new Date(p.pairCreatedAt).toISOString()
        : new Date().toISOString(),
    });

    if (signals.length >= 16) break;
  }

  return signals;
}

async function refreshLiveSolanaMarkets(force = false): Promise<SolanaToken[]> {
  const now = Date.now();
  if (!force && liveTokensCache.length > 0 && now - liveTokensCacheAt < 15_000) {
    return mergeSessionTokens(liveTokensCache);
  }

  const canonicalAddresses = CANONICAL_SOLANA_MINTS.map((m) => m.address);
  const boostedItems = await fetchLiveBoostedSolanaAddresses();
  const boostedAddresses = boostedItems.map((b) => b.address).slice(0, 14);
  const boostedDescByAddr = new Map(
    boostedItems.map((b) => [b.address, b.description])
  );

  const allTargetAddresses = [
    ...new Set([...canonicalAddresses, ...boostedAddresses]),
  ];

  const [pairs, mintAuthorities] = await Promise.all([
    fetchDexPairsForAddresses(allTargetAddresses),
    fetchMintAuthoritiesBatch(allTargetAddresses),
  ]);

  const bestPairs: RawDexScreenerPair[] = [];
  const nextTokens: SolanaToken[] = [];

  for (const addr of allTargetAddresses) {
    const best = selectBestSolanaPair(pairs, addr);
    if (!best) continue;
    bestPairs.push(best);
    const mapped = mapDexPairToSolanaToken(best, mintAuthorities.get(addr));
    if (mapped) {
      nextTokens.push(mapped);
    }
  }

  if (nextTokens.length > 0) {
    liveTokensCache = nextTokens;
    liveTokensCacheAt = now;
    liveFeedConnected = true;

    const trendingFromPairs: TrendingCoin[] = [];
    const seenTrending = new Set<string>();
    let idx = 0;

    // Prioritize live boosted/latest Solana pairs, then top active canonical pairs
    const prioritizedPairs = [
      ...boostedAddresses
        .map((addr) => selectBestSolanaPair(pairs, addr))
        .filter((p): p is RawDexScreenerPair => Boolean(p)),
      ...bestPairs,
    ];

    for (const pair of prioritizedPairs) {
      const addr = pair.baseToken?.address;
      if (!addr || seenTrending.has(addr)) continue;
      seenTrending.add(addr);
      const coin = mapDexPairToTrendingCoin(pair, idx, boostedDescByAddr.get(addr));
      if (coin) {
        trendingFromPairs.push(coin);
        idx += 1;
      }
      if (trendingFromPairs.length >= 20) break;
    }

    liveTrendingCache = trendingFromPairs;
    liveTrendingCacheAt = now;
    liveXSignalsCache = buildLiveXSignalsFromPairs(prioritizedPairs);
  } else {
    liveFeedConnected = false;
  }

  return mergeSessionTokens(liveTokensCache);
}

function mergeSessionTokens(base: SolanaToken[]): SolanaToken[] {
  const byAddr = new Map<string, SolanaToken>();
  for (const [addr, tok] of verifiedSessionTokens.entries()) {
    byAddr.set(addr, tok);
  }
  for (const tok of base) {
    const existing = byAddr.get(tok.address);
    if (existing) {
      // Preserve live DEX market stats if our launched token now has a live DEX pool!
      byAddr.set(tok.address, {
        ...existing,
        ...tok,
        launchedByUser: existing.launchedByUser,
        txSignature: existing.txSignature,
      });
    } else {
      byAddr.set(tok.address, tok);
    }
  }
  return [...byAddr.values()];
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // ---------- 1. Allowlisted Solana JSON-RPC Proxy ----------
  app.post('/api/solana/rpc', async (req, res) => {
    const cluster = normalizeCluster(req.query.network);
    const body = req.body as
      | { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] }
      | Array<{ jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] }>;

    const handleSingle = async (item: {
      id?: unknown;
      method?: string;
      params?: unknown[];
    }) => {
      if (!item || typeof item.method !== 'string' || !ALLOWED_RPC_METHODS.has(item.method)) {
        return {
          jsonrpc: '2.0',
          id: item?.id ?? null,
          error: {
            code: -32601,
            message: `RPC method not permitted: ${String(item?.method ?? '')}`,
          },
        };
      }
      try {
        const { result } = await solanaRpcCall(
          cluster,
          item.method,
          Array.isArray(item.params) ? item.params : []
        );
        return { jsonrpc: '2.0', id: item.id ?? 1, result };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id: item.id ?? 1,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : 'Solana RPC execution error',
          },
        };
      }
    };

    if (Array.isArray(body)) {
      if (body.length > 12) {
        res.status(400).json({ error: 'Batch RPC size limited to 12 calls.' });
        return;
      }
      const results = await Promise.all(body.map(handleSingle));
      res.json(results);
      return;
    }

    const result = await handleSingle(body);
    res.json(result);
  });

  // ---------- 2. Live Solana Chain State ----------
  app.get('/api/solana/chain-state', async (req, res) => {
    const cluster = normalizeCluster(req.query.network);
    try {
      const [epochRes, perfRes] = await Promise.all([
        solanaRpcCall<{
          absoluteSlot: number;
          blockHeight: number;
          epoch: number;
        }>(cluster, 'getEpochInfo', [{ commitment: 'confirmed' }]),
        solanaRpcCall<
          Array<{ numTransactions: number; samplePeriodSecs: number }>
        >(cluster, 'getRecentPerformanceSamples', [1]).catch(() => ({
          result: [],
          endpoint: '',
        })),
      ]);

      const sample = Array.isArray(perfRes.result) ? perfRes.result[0] : null;
      const tps =
        sample && sample.samplePeriodSecs > 0
          ? Math.round(sample.numTransactions / sample.samplePeriodSecs)
          : null;

      const state: SolanaChainState = {
        cluster,
        slot: epochRes.result?.absoluteSlot ?? 0,
        blockHeight: epochRes.result?.blockHeight ?? 0,
        epoch: epochRes.result?.epoch ?? 0,
        tps,
        healthy: true,
        rpcEndpointLabel:
          cluster === 'Devnet' ? 'Solana Devnet RPC' : 'Solana Mainnet-Beta RPC',
        fetchedAt: new Date().toISOString(),
      };
      res.json(state);
    } catch (err) {
      res.status(502).json({
        cluster,
        slot: 0,
        blockHeight: 0,
        epoch: 0,
        tps: null,
        healthy: false,
        rpcEndpointLabel: `Solana ${cluster} RPC`,
        fetchedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Chain state unavailable',
      });
    }
  });

  // ---------- 3. Live Real Solana Markets ----------
  app.get('/api/tokens', async (req, res) => {
    const force = req.query.force === '1';
    const tokens = await refreshLiveSolanaMarkets(force);
    res.json({
      tokens,
      liveFeedConnected,
      lastSyncedAt: new Date().toISOString(),
    });
  });

  app.get('/api/trending-clone', async (req, res) => {
    const force = req.query.force === '1';
    if (force || liveTrendingCache.length === 0 || Date.now() - liveTrendingCacheAt > 20_000) {
      await refreshLiveSolanaMarkets(true);
    }
    res.json({
      coins: liveTrendingCache,
      liveFeedConnected,
      lastSyncedAt: new Date().toISOString(),
    });
  });

  app.get('/api/x-tracker', async (_req, res) => {
    if (liveXSignalsCache.length === 0) {
      await refreshLiveSolanaMarkets(false);
    }
    res.json({
      signals: liveXSignalsCache,
      liveFeedConnected,
    });
  });

  // ---------- 4. Register Verified On-Chain Launched SPL Token ----------
  app.post('/api/tokens/register', async (req, res) => {
    const body = req.body as {
      address?: string;
      txSignature?: string;
      cluster?: SolanaCluster;
      symbol?: string;
      name?: string;
      category?: SolanaToken['category'];
      description?: string;
      decimals?: number;
      totalSupply?: number;
      imageUrl?: string;
      socials?: SolanaToken['socials'];
      creatorName?: string;
      creatorWebsite?: string;
      walletAddress?: string;
      costSol?: number;
    };

    const address = String(body.address ?? '').trim();
    const txSignature = String(body.txSignature ?? '').trim();
    const cluster = normalizeCluster(body.cluster);

    if (!isValidSolanaPublicKey(address)) {
      res.status(400).json({ error: 'Invalid Solana mint address.' });
      return;
    }
    if (!txSignature || !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(txSignature)) {
      res.status(400).json({ error: 'Valid confirmed Solana transaction signature is required.' });
      return;
    }

    // Verify mint actually exists on-chain before registering!
    let parsedMint: ParsedMintAuthorityState;
    try {
      const { result } = await solanaRpcCall<{ value: unknown }>(
        cluster,
        'getAccountInfo',
        [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]
      );
      parsedMint = parseMintAccountJsonParsed(result?.value);
      if (!parsedMint.exists) {
        res.status(400).json({
          error: `Mint ${address} was not found on Solana ${cluster}. Broadcast the transaction on-chain first.`,
        });
        return;
      }
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Could not verify mint on Solana ${cluster}: ${err.message}`
            : 'RPC verification failed.',
      });
      return;
    }

    const cleanSymbol = String(body.symbol ?? 'SPL')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
    const cleanName = String(body.name ?? cleanSymbol).trim().slice(0, 48);
    const cleanDesc = String(
      body.description ?? `SPL token minted on Solana ${cluster}.`
    )
      .trim()
      .slice(0, 500);

    const verifiedToken: SolanaToken = {
      address,
      symbol: cleanSymbol || 'SPL',
      name: cleanName || 'Solana Token',
      category: body.category || 'Meme',
      priceUsd: 0,
      change5m: 0,
      change1h: 0,
      change24h: 0,
      volume24h: 0,
      liquidityUsd: 0,
      marketCap: 0,
      holders: 1,
      ageHours: 0.05,
      boostMultiplier: 1,
      boostTier: 'none',
      verifiedDev: parsedMint.mintRevoked && parsedMint.freezeRevoked,
      security: {
        mintRevoked: parsedMint.mintRevoked,
        freezeRevoked: parsedMint.freezeRevoked,
        lpLockedMonths: 0,
        metadataImmutable: parsedMint.mintRevoked && parsedMint.freezeRevoked,
      },
      sparkline: [0, 0],
      description: cleanDesc,
      decimals: parsedMint.decimals,
      totalSupply: parsedMint.supplyUi || Number(body.totalSupply ?? 0),
      imageUrl:
        typeof body.imageUrl === 'string' &&
        (body.imageUrl.startsWith('data:image/') || sanitizeExternalUrl(body.imageUrl))
          ? body.imageUrl
          : undefined,
      socials: {
        website: sanitizeExternalUrl(body.socials?.website),
        twitter: sanitizeExternalUrl(body.socials?.twitter),
        telegram: sanitizeExternalUrl(body.socials?.telegram),
        discord: sanitizeExternalUrl(body.socials?.discord),
      },
      creatorName: body.creatorName ? String(body.creatorName).trim().slice(0, 64) : undefined,
      creatorWebsite: sanitizeExternalUrl(body.creatorWebsite),
      launchedByUser: true,
      dexSource: `Solana ${cluster} SPL`,
      mintAuthority: parsedMint.mintAuthority,
      freezeAuthority: parsedMint.freezeAuthority,
      onChainVerified: true,
      cluster,
      txSignature,
    };

    verifiedSessionTokens.set(address, verifiedToken);

    const announcement: Announcement = {
      id: `ann-launch-${Date.now()}`,
      category: 'Launch',
      title: `${verifiedToken.name} ($${verifiedToken.symbol}) Minted On-Chain (${cluster})`,
      body: `Verified SPL Mint ${address} deployed on Solana ${cluster} (${parsedMint.supplyUi.toLocaleString('en-US')} supply, ${parsedMint.decimals} decimals). Mint authority ${parsedMint.mintRevoked ? 'REVOKED' : 'active'}, Freeze authority ${parsedMint.freezeRevoked ? 'REVOKED' : 'active'}. Tx: ${txSignature}`,
      tokenSymbol: verifiedToken.symbol,
      tokenAddress: address,
      txSignature,
      author: verifiedToken.creatorName || `${verifiedToken.symbol} Deployer`,
      walletAddress: shortenAddress(String(body.walletAddress || address)),
      verified: true,
      createdAt: new Date().toISOString(),
      upvotes: 1,
    };

    announcementsRegistry = [announcement, ...announcementsRegistry];

    res.status(201).json({
      token: verifiedToken,
      announcement,
      onChainVerified: true,
    });
  });

  // ---------- 5. Live On-Chain Token & Pool Inspector ----------
  app.get('/api/solana/token/:address', async (req, res) => {
    const address = String(req.params.address ?? '').trim();
    const cluster = normalizeCluster(req.query.network);

    if (!isValidSolanaPublicKey(address)) {
      res.status(400).json({ error: 'Invalid Solana mint address.' });
      return;
    }

    try {
      const [accountRes, largestRes, dexPairs] = await Promise.all([
        solanaRpcCall<{ value: unknown }>(cluster, 'getAccountInfo', [
          address,
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ]),
        solanaRpcCall<{
          value?: Array<{
            address: string;
            amount: string;
            decimals: number;
            uiAmount: number | null;
          }>;
        }>(cluster, 'getTokenLargestAccounts', [
          address,
          { commitment: 'confirmed' },
        ]).catch(() => ({ result: { value: [] }, endpoint: '' })),
        cluster === 'Mainnet-Beta'
          ? fetchDexPairsForAddresses([address])
          : Promise.resolve([]),
      ]);

      const parsed = parseMintAccountJsonParsed(accountRes.result?.value);
      const pools = mapDexPairsToPools(
        dexPairs.filter((p) => p.baseToken?.address === address)
      );
      const bestPair = selectBestSolanaPair(dexPairs, address);
      const liveToken = bestPair ? mapDexPairToSolanaToken(bestPair, parsed) : null;

      const largestAccounts = Array.isArray(largestRes.result?.value)
        ? largestRes.result.value
        : [];
      const topHolders: OnChainHolderInfo[] = largestAccounts.slice(0, 10).map((acc) => {
        const uiAmount =
          typeof acc.uiAmount === 'number'
            ? acc.uiAmount
            : fromRawTokenAmount(acc.amount, acc.decimals);
        const pctOfSupply =
          parsed.supplyUi > 0
            ? Number(((uiAmount / parsed.supplyUi) * 100).toFixed(3))
            : 0;
        return {
          tokenAccount: acc.address,
          amountUi: uiAmount,
          pctOfSupply,
        };
      });

      const canonical = CANONICAL_SOLANA_MINTS.find((c) => c.address === address);
      const inspection: OnChainTokenInspection = {
        address,
        cluster,
        existsOnChain: parsed.exists,
        programId: parsed.programId,
        decimals: parsed.decimals,
        supplyUi: parsed.supplyUi,
        mintAuthority: parsed.mintAuthority,
        freezeAuthority: parsed.freezeAuthority,
        mintRevoked: parsed.mintRevoked,
        freezeRevoked: parsed.freezeRevoked,
        name: liveToken?.name ?? canonical?.name,
        symbol: liveToken?.symbol ?? canonical?.symbol,
        imageUrl: liveToken?.imageUrl,
        priceUsd: liveToken?.priceUsd ?? 0,
        marketCapUsd: liveToken?.marketCap ?? 0,
        totalLiquidityUsd: pools.reduce((acc, p) => acc + p.liquidityUsd, 0),
        volume24hUsd: pools.reduce((acc, p) => acc + p.volume24h, 0),
        pools,
        topHolders,
        fetchedAt: new Date().toISOString(),
      };

      res.json({ inspection, token: liveToken });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Failed to inspect mint on Solana ${cluster}: ${err.message}`
            : 'On-chain inspection failed.',
      });
    }
  });

  // ---------- 6. Live On-Chain Wallet Asset Retrieval (SOL + SPL + Token-2022 + Tx History) ----------
  app.get('/api/solana/wallet/:address', async (req, res) => {
    const address = String(req.params.address ?? '').trim();
    const cluster = normalizeCluster(req.query.network);

    if (!isValidSolanaPublicKey(address)) {
      res.status(400).json({ error: 'Invalid Solana wallet public key.' });
      return;
    }

    try {
      const [balRes, splRes, spl2022Res, sigRes] = await Promise.all([
        solanaRpcCall<{ value: number }>(cluster, 'getBalance', [
          address,
          { commitment: 'confirmed' },
        ]),
        solanaRpcCall<{ value?: RawRpcTokenAccountItem[] }>(
          cluster,
          'getTokenAccountsByOwner',
          [
            address,
            { programId: TOKEN_PROGRAM_ID },
            { encoding: 'jsonParsed', commitment: 'confirmed' },
          ]
        ),
        solanaRpcCall<{ value?: RawRpcTokenAccountItem[] }>(
          cluster,
          'getTokenAccountsByOwner',
          [
            address,
            { programId: TOKEN_2022_PROGRAM_ID },
            { encoding: 'jsonParsed', commitment: 'confirmed' },
          ]
        ).catch(() => ({ result: { value: [] }, endpoint: '' })),
        solanaRpcCall<
          Array<{
            signature: string;
            slot: number;
            blockTime: number | null;
            err: unknown;
            memo: string | null;
            confirmationStatus?: string;
          }>
        >(cluster, 'getSignaturesForAddress', [address, { limit: 25 }]).catch(
          () => ({ result: [], endpoint: '' })
        ),
      ]);

      const solLamports = Number(balRes.result?.value ?? 0);
      const solBalance = lamportsToSol(solLamports);

      const rawTokenAccounts: RawRpcTokenAccountItem[] = [
        ...(Array.isArray(splRes.result?.value) ? splRes.result.value : []),
        ...(Array.isArray(spl2022Res.result?.value) ? spl2022Res.result.value : []),
      ];

      // Build market pricing map for SOL + non-empty owned mints (live DexScreener on Mainnet)
      const nonEmptyMints = [
        ...new Set(
          rawTokenAccounts
            .filter((a) => {
              const rawAmt = a.account?.data?.parsed?.info?.tokenAmount?.amount;
              return Boolean(rawAmt && rawAmt !== '0');
            })
            .map((a) => a.account?.data?.parsed?.info?.mint)
            .filter((m): m is string => Boolean(m && isValidSolanaPublicKey(m)))
        ),
      ];

      const marketByMint = new Map<
        string,
        {
          symbol: string;
          name: string;
          priceUsd: number;
          imageUrl?: string;
          pairAddress?: string;
          dexSource?: string;
        }
      >();

      // Seed from already cached live tokens + session verified tokens
      for (const tok of mergeSessionTokens(liveTokensCache)) {
        marketByMint.set(tok.address, {
          symbol: tok.symbol,
          name: tok.name,
          priceUsd: tok.priceUsd,
          imageUrl: tok.imageUrl,
          pairAddress: tok.pairAddress,
          dexSource: tok.dexSource,
        });
      }

      // Fetch live DexScreener pricing for SOL + unknown non-empty owned mints
      const missingMints = [SOL_MINT_ADDRESS, ...nonEmptyMints].filter(
        (m) => !marketByMint.has(m)
      );
      if (missingMints.length > 0) {
        const extraPairs = await fetchDexPairsForAddresses(missingMints.slice(0, 56));
        for (const mint of missingMints.slice(0, 56)) {
          const best = selectBestSolanaPair(extraPairs, mint);
          if (best) {
            marketByMint.set(mint, {
              symbol: (best.baseToken?.symbol ?? 'SPL').toUpperCase(),
              name: best.baseToken?.name ?? 'SPL Token',
              priceUsd: Number(best.priceUsd ?? 0),
              imageUrl: sanitizeExternalUrl(best.info?.imageUrl),
              pairAddress: best.pairAddress,
              dexSource: best.dexId,
            });
          }
        }
      }

      const solPriceUsd = marketByMint.get(SOL_MINT_ADDRESS)?.priceUsd ?? 0;
      const solValueUsd = Number((solBalance * solPriceUsd).toFixed(4));
      const allParsedAccounts = parseRpcTokenAccounts(rawTokenAccounts, marketByMint);
      const totalValueUsd = Number(
        (
          solValueUsd +
          allParsedAccounts.reduce((acc, item) => acc + item.valueUsd, 0)
        ).toFixed(4)
      );

      // Keep top 80 active holdings (by USD value & balance) + top 20 empty reclaimable accounts
      const activeAccounts = allParsedAccounts
        .filter((a) => !a.isEmpty)
        .slice(0, 80);
      const emptyReclaimable = allParsedAccounts
        .filter((a) => a.isEmpty)
        .slice(0, 20);
      const tokenAccounts = [...activeAccounts, ...emptyReclaimable];

      const recentSignatures = (Array.isArray(sigRes.result) ? sigRes.result : []).map(
        (s) => ({
          signature: s.signature,
          slot: s.slot,
          blockTime: s.blockTime ?? null,
          err: Boolean(s.err),
          memo: s.memo ?? null,
          confirmationStatus: s.confirmationStatus ?? 'finalized',
          timestamp: s.blockTime
            ? new Date(s.blockTime * 1000).toISOString()
            : new Date().toISOString(),
          status: (s.err ? 'Failed' : 'Confirmed') as 'Confirmed' | 'Failed',
        })
      );

      const snapshot: WalletOnChainSnapshot = {
        address,
        cluster,
        solLamports,
        solBalance,
        solPriceUsd,
        solValueUsd,
        totalValueUsd,
        tokenAccounts,
        recentSignatures,
        fetchedAt: new Date().toISOString(),
      };

      res.json(snapshot);
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Could not fetch wallet assets from Solana ${cluster}: ${err.message}`
            : 'Wallet RPC retrieval failed.',
      });
    }
  });

  // ---------- 7. Live Jupiter v6 Quote & Swap Transaction Builder ----------
  app.get('/api/solana/jupiter-quote', async (req, res) => {
    const inputMint = String(req.query.inputMint ?? '').trim();
    const outputMint = String(req.query.outputMint ?? '').trim();
    const amount = String(req.query.amount ?? '').trim();
    const slippageBps = Math.max(
      1,
      Math.min(5000, Math.round(Number(req.query.slippageBps ?? 50)))
    );

    if (!isValidSolanaPublicKey(inputMint) || !isValidSolanaPublicKey(outputMint)) {
      res.status(400).json({ error: 'Valid inputMint and outputMint Solana addresses are required.' });
      return;
    }
    if (inputMint === outputMint) {
      res.status(400).json({ error: 'Input and output tokens must be different.' });
      return;
    }
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      res.status(400).json({ error: 'Amount in base units must be a positive integer.' });
      return;
    }

    try {
      const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
      url.searchParams.set('inputMint', inputMint);
      url.searchParams.set('outputMint', outputMint);
      url.searchParams.set('amount', amount);
      url.searchParams.set('slippageBps', String(slippageBps));

      const raw = await fetchJsonWithTimeout<Record<string, unknown>>(
        url.toString(),
        {},
        7500
      );
      const quote = parseJupiterQuoteResponse(raw);
      if (!quote) {
        res.status(400).json({
          error:
            typeof raw.error === 'string'
              ? raw.error
              : 'No live Jupiter v6 route available for this pair/amount.',
        });
        return;
      }

      res.json({ quote });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Jupiter v6 quote error: ${err.message}`
            : 'Jupiter v6 quote unavailable.',
      });
    }
  });

  app.post('/api/solana/jupiter-swap', async (req, res) => {
    const { userPublicKey, quoteResponse } = req.body as {
      userPublicKey?: string;
      quoteResponse?: Record<string, unknown>;
    };

    if (!userPublicKey || !isValidSolanaPublicKey(userPublicKey)) {
      res.status(400).json({ error: 'Valid Solana userPublicKey is required.' });
      return;
    }
    if (!quoteResponse || typeof quoteResponse !== 'object') {
      res.status(400).json({ error: 'Live Jupiter quoteResponse is required.' });
      return;
    }

    try {
      const payload = await fetchJsonWithTimeout<{
        swapTransaction?: string;
        lastValidBlockHeight?: number;
        error?: string;
      }>(
        'https://lite-api.jup.ag/swap/v1/swap',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey: userPublicKey.trim(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto',
          }),
        },
        9000
      );

      if (!payload.swapTransaction) {
        res.status(400).json({
          error: payload.error || 'Jupiter did not return a swapTransaction.',
        });
        return;
      }

      res.json({
        swapTransaction: payload.swapTransaction,
        lastValidBlockHeight: payload.lastValidBlockHeight,
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Jupiter v6 swap build failed: ${err.message}`
            : 'Could not construct Jupiter v6 swap transaction.',
      });
    }
  });

  // ---------- 8. Real Solana Devnet Faucet Airdrop (Strictly Devnet Only) ----------
  app.post('/api/solana/devnet-airdrop', async (req, res) => {
    const address = String((req.body as { address?: string })?.address ?? '').trim();
    if (!isValidSolanaPublicKey(address)) {
      res.status(400).json({ error: 'Valid Solana address is required for Devnet airdrop.' });
      return;
    }

    try {
      const { result: signature } = await solanaRpcCall<string>(
        'Devnet',
        'requestAirdrop',
        [address, 1_000_000_000]
      );
      res.json({
        signature,
        amountSol: 1,
        cluster: 'Devnet',
      });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Solana Devnet faucet rate-limited or failed: ${err.message}. You can also request Devnet SOL at https://faucet.solana.com`
            : 'Solana Devnet airdrop failed.',
      });
    }
  });

  // ---------- 9. Announcements Feed (Real Broadcasts Only) ----------
  app.get('/api/announcements', (_req, res) => {
    res.json({ announcements: announcementsRegistry });
  });

  app.post('/api/announcements', (req, res) => {
    const {
      category,
      title,
      body,
      tokenSymbol,
      tokenAddress,
      txSignature,
      author,
      walletAddress,
    } = req.body as {
      category?: AnnouncementCategory;
      title?: string;
      body?: string;
      tokenSymbol?: string;
      tokenAddress?: string;
      txSignature?: string;
      author?: string;
      walletAddress?: string;
    };

    const cleanTitle = String(title ?? '').trim();
    const cleanBody = String(body ?? '').trim();
    const validCategories: AnnouncementCategory[] = [
      'Launch',
      'Boost',
      'Network',
      'Security',
    ];
    const safeCategory: AnnouncementCategory = validCategories.includes(
      category as AnnouncementCategory
    )
      ? (category as AnnouncementCategory)
      : 'Network';

    if (cleanTitle.length < 6 || cleanTitle.length > 140) {
      res
        .status(400)
        .json({ error: 'Headline must be between 6 and 140 characters.' });
      return;
    }

    if (cleanBody.length < 16 || cleanBody.length > 800) {
      res
        .status(400)
        .json({ error: 'Announcement details must be between 16 and 800 characters.' });
      return;
    }

    const newAnnouncement: Announcement = {
      id: `ann-${Date.now()}`,
      category: safeCategory,
      title: cleanTitle,
      body: cleanBody,
      tokenSymbol: tokenSymbol
        ? String(tokenSymbol).toUpperCase().slice(0, 12)
        : undefined,
      tokenAddress:
        tokenAddress && isValidSolanaPublicKey(tokenAddress)
          ? tokenAddress.trim()
          : undefined,
      txSignature:
        txSignature && /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(txSignature.trim())
          ? txSignature.trim()
          : undefined,
      author: String(author || 'Verified Dev').trim().slice(0, 48),
      walletAddress: shortenAddress(String(walletAddress || 'Solana')),
      verified: Boolean(walletAddress && isValidSolanaPublicKey(walletAddress)),
      createdAt: new Date().toISOString(),
      upvotes: 1,
    };

    announcementsRegistry = [newAnnouncement, ...announcementsRegistry];
    res.status(201).json({ announcement: newAnnouncement });
  });

  app.post('/api/announcements/:id/upvote', (req, res) => {
    const { id } = req.params;
    const idx = announcementsRegistry.findIndex((a) => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Announcement not found.' });
      return;
    }
    const updated = {
      ...announcementsRegistry[idx],
      upvotes: announcementsRegistry[idx].upvotes + 1,
    };
    announcementsRegistry = [
      ...announcementsRegistry.slice(0, idx),
      updated,
      ...announcementsRegistry.slice(idx + 1),
    ];
    res.json({ announcement: updated });
  });

  // ---------- 10. Live Gemini AI Sentiment & Personalized Insights ----------
  app.post('/api/ai/sentiment', async (req, res) => {
    const { address, riskProfile, tokenSnapshot } = req.body as {
      address?: string;
      riskProfile?: RiskProfile;
      tokenSnapshot?: SolanaToken;
    };

    const allLive = await refreshLiveSolanaMarkets(false);
    const token =
      allLive.find((t) => t.address === address) ??
      (tokenSnapshot && tokenSnapshot.address === address ? tokenSnapshot : undefined);
    if (!token) {
      res.status(404).json({ error: 'Token not found for sentiment analysis.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable live AI sentiment analysis.',
      });
      return;
    }

    const safeRisk: RiskProfile =
      riskProfile === 'Conservative' || riskProfile === 'Aggressive'
        ? riskProfile
        : 'Balanced';

    const prompt = `Analyze this live on-chain Solana token for a ${safeRisk} risk-profile trader on YABBAI.
Token: ${token.name} (${token.symbol})
Mint Address: ${token.address}
DEX Source: ${token.dexSource}
Price USD: $${token.priceUsd}
5m / 1h / 24h change: ${token.change5m}% / ${token.change1h}% / ${token.change24h}%
24h Volume USD: $${token.volume24h}
Liquidity USD: $${token.liquidityUsd}
Market Cap USD: $${token.marketCap}
24h On-Chain Transactions: ${token.holders}
On-Chain Security Flags: mintRevoked=${token.security.mintRevoked}, freezeRevoked=${token.security.freezeRevoked}
Description: ${token.description}

Return concise, institutional-grade quantitative sentiment analysis grounded strictly in these real on-chain metrics.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are YABBAI Quantitative Research Analyst for Solana markets. Produce objective, clear, data-grounded sentiment assessments without financial guarantees or hype.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              polarity: {
                type: Type.STRING,
                enum: ['Bullish', 'Neutral', 'Cautious', 'Bearish'],
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Confidence score from 0 to 100',
              },
              summary: {
                type: Type.STRING,
                description: 'Two-sentence executive sentiment overview.',
              },
              catalysts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 to 3 concrete momentum or liquidity drivers.',
              },
              risks: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 to 3 concrete liquidity, volatility, or concentration risks.',
              },
              devHealthAssessment: {
                type: Type.STRING,
                description: 'One concise sentence evaluating on-chain mint & freeze authority state.',
              },
              personalizedTake: {
                type: Type.STRING,
                description: 'Tailored takeaway specifically for the requested trader risk profile.',
              },
            },
            required: [
              'polarity',
              'confidence',
              'summary',
              'catalysts',
              'risks',
              'devHealthAssessment',
              'personalizedTake',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
        SentimentAnalysis,
        'tokenSymbol' | 'riskProfile' | 'analyzedAt' | 'modelUsed'
      >;

      const analysis: SentimentAnalysis = {
        ...parsed,
        tokenSymbol: token.symbol,
        riskProfile: safeRisk,
        analyzedAt: new Date().toISOString(),
        modelUsed: 'gemini-4-hydrogen',
      };

      res.json({ analysis });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'AI sentiment service failed.';
      res.status(502).json({
        error: `AI sentiment request failed: ${message}`,
      });
    }
  });

  app.post('/api/ai/insights', async (req, res) => {
    const { riskProfile, extraTokens } = req.body as {
      riskProfile?: RiskProfile;
      extraTokens?: SolanaToken[];
    };
    const ai = getGeminiClient();

    if (!ai) {
      res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to generate personalized AI briefs.',
      });
      return;
    }

    const safeRisk: RiskProfile =
      riskProfile === 'Conservative' || riskProfile === 'Aggressive'
        ? riskProfile
        : 'Balanced';

    const allLive = await refreshLiveSolanaMarkets(false);
    const mergedByAddr = new Map<string, SolanaToken>();
    for (const t of allLive) mergedByAddr.set(t.address, t);
    if (Array.isArray(extraTokens)) {
      for (const t of extraTokens) {
        if (t && typeof t.address === 'string' && isValidSolanaPublicKey(t.address)) {
          mergedByAddr.set(t.address, t);
        }
      }
    }

    const topMovers = [...mergedByAddr.values()]
      .filter((t) => t.priceUsd > 0)
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 6)
      .map(
        (t) =>
          `${t.symbol} (${t.dexSource}): $${t.priceUsd}, 1h ${t.change1h}%, 24h ${t.change24h}%, Vol $${Math.round(t.volume24h).toLocaleString('en-US')}, Liq $${Math.round(t.liquidityUsd).toLocaleString('en-US')}`
      )
      .join('\n');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Generate a personalized Solana top-gainers brief for a ${safeRisk} investor based on these live on-chain Solana tokens:\n${topMovers}`,
        config: {
          systemInstruction:
            'You are YABBAI Market Intelligence. Write concise, institutional Solana ecosystem briefs with balanced risk awareness. Never promise returns.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              marketPulse: { type: Type.STRING },
              topPicks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    symbol: { type: Type.STRING },
                    thesis: { type: Type.STRING },
                    conviction: {
                      type: Type.STRING,
                      enum: ['High', 'Moderate', 'Watch'],
                    },
                  },
                  required: ['symbol', 'thesis', 'conviction'],
                },
              },
              riskAdvisory: { type: Type.STRING },
            },
            required: ['headline', 'marketPulse', 'topPicks', 'riskAdvisory'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
        PersonalizedBrief,
        'riskProfile' | 'generatedAt' | 'modelUsed'
      >;

      const brief: PersonalizedBrief = {
        ...parsed,
        riskProfile: safeRisk,
        generatedAt: new Date().toISOString(),
        modelUsed: 'gemini-4-hydrogen',
      };

      res.json({ brief });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'AI insights generation failed.';
      res.status(502).json({
        error: `Personalized AI insights request failed: ${message}`,
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YABBAI Solana Suite (Live On-Chain) listening on http://localhost:${PORT}`);
  });
}

startServer();
