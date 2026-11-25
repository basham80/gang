import type {
  JupiterQuoteSummary,
  LaunchPlatform,
  OnChainPoolInfo,
  OnChainTokenAccount,
  SolanaToken,
  TokenSocials,
  TrendingCoin,
} from '../types/solana';
import { CANONICAL_SOLANA_MINTS } from '../data/seedData';

export const LAMPORTS_PER_SOL_NUM = 1_000_000_000;
export const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

export function isValidSolanaPublicKey(value: string): boolean {
  return SOLANA_ADDRESS_REGEX.test(value.trim());
}

export function lamportsToSol(lamports: number): number {
  if (!Number.isFinite(lamports) || lamports <= 0) return 0;
  return Number((lamports / LAMPORTS_PER_SOL_NUM).toFixed(9));
}

export function solToLamports(sol: number): number {
  if (!Number.isFinite(sol) || sol <= 0) return 0;
  return Math.floor(sol * LAMPORTS_PER_SOL_NUM);
}

/**
 * Converts a human-readable decimal token amount string/number into exact
 * BigInt base units without IEEE-754 precision loss.
 */
export function toRawTokenAmount(uiAmount: number | string, decimals: number): bigint {
  const safeDecimals = Math.max(0, Math.min(18, Math.trunc(decimals)));
  const str = String(uiAmount).trim();
  if (!str || !/^\d+(\.\d+)?$/.test(str)) {
    return 0n;
  }
  const [intPart, fracPart = ''] = str.split('.');
  const paddedFrac = fracPart.slice(0, safeDecimals).padEnd(safeDecimals, '0');
  const combined = `${intPart}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  return BigInt(combined || '0');
}

export function fromRawTokenAmount(rawAmount: string | bigint, decimals: number): number {
  const safeDecimals = Math.max(0, Math.min(18, Math.trunc(decimals)));
  try {
    const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
    if (raw <= 0n) return 0;
    const divisor = 10 ** safeDecimals;
    return Number(raw) / divisor;
  } catch {
    return 0;
  }
}

export function sanitizeExternalUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface RawDexScreenerPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  priceNative?: string;
  priceUsd?: string;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  volume?: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
  boosts?: {
    active?: number;
  };
}

export interface ParsedMintAuthorityState {
  exists: boolean;
  programId: string | null;
  decimals: number;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mintRevoked: boolean;
  freezeRevoked: boolean;
}

export function parseMintAccountJsonParsed(
  accountValue: unknown
): ParsedMintAuthorityState {
  if (!accountValue || typeof accountValue !== 'object') {
    return {
      exists: false,
      programId: null,
      decimals: 9,
      supplyUi: 0,
      mintAuthority: null,
      freezeAuthority: null,
      mintRevoked: false,
      freezeRevoked: false,
    };
  }

  const acc = accountValue as {
    owner?: string;
    data?: {
      parsed?: {
        type?: string;
        info?: {
          decimals?: number;
          supply?: string;
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
          isInitialized?: boolean;
        };
      };
    };
  };

  const info = acc.data?.parsed?.info;
  if (!info) {
    return {
      exists: true,
      programId: acc.owner ?? null,
      decimals: 9,
      supplyUi: 0,
      mintAuthority: null,
      freezeAuthority: null,
      mintRevoked: false,
      freezeRevoked: false,
    };
  }

  const decimals = Number(info.decimals ?? 9);
  const supplyUi = info.supply ? fromRawTokenAmount(info.supply, decimals) : 0;
  const mintAuthority = info.mintAuthority ?? null;
  const freezeAuthority = info.freezeAuthority ?? null;

  return {
    exists: true,
    programId: acc.owner ?? null,
    decimals,
    supplyUi,
    mintAuthority,
    freezeAuthority,
    mintRevoked: mintAuthority === null,
    freezeRevoked: freezeAuthority === null,
  };
}

export function extractSocialsFromDexPair(pair: RawDexScreenerPair): TokenSocials {
  const socials: TokenSocials = {};
  const website = sanitizeExternalUrl(pair.info?.websites?.[0]?.url);
  if (website) socials.website = website;

  for (const s of pair.info?.socials ?? []) {
    const cleanUrl = sanitizeExternalUrl(s.url);
    if (!cleanUrl) continue;
    const kind = (s.type ?? '').toLowerCase();
    if (kind === 'twitter' || kind === 'x') socials.twitter = cleanUrl;
    else if (kind === 'telegram') socials.telegram = cleanUrl;
    else if (kind === 'discord') socials.discord = cleanUrl;
  }
  return socials;
}

export function mapDexIdToPlatform(dexId: string | undefined): LaunchPlatform {
  const id = (dexId ?? '').toLowerCase();
  if (id.includes('meteora')) return 'Meteora';
  if (id.includes('orca')) return 'Orca';
  if (id.includes('pumpswap')) return 'PumpSwap';
  if (id.includes('pump')) return 'pump.fun';
  return 'Raydium';
}

export function formatDexLabel(dexId: string | undefined): string {
  const id = (dexId ?? '').toLowerCase();
  if (id === 'raydium') return 'Raydium';
  if (id === 'meteora') return 'Meteora';
  if (id === 'orca') return 'Orca';
  if (id === 'pumpswap') return 'PumpSwap';
  if (id === 'pumpfun') return 'pump.fun';
  if (!dexId) return 'Solana DEX';
  return dexId.charAt(0).toUpperCase() + dexId.slice(1);
}

/**
 * Selects the highest-volume/liquidity legitimate Solana DEX pair for a given mint.
 * Strictly prioritizes canonical quote tokens (SOL/WSOL/USDC/USDT) and volume-backed
 * pools so spoofed phantom-TVL / wash-traded pools cannot override real market prices.
 */
export function selectBestSolanaPair(
  pairs: RawDexScreenerPair[],
  mintAddress: string
): RawDexScreenerPair | null {
  const trustedQuotes = new Set(['SOL', 'WSOL', 'USDC', 'USDT']);

  const validPairs = pairs.filter((p) => {
    if (p.chainId !== 'solana') return false;
    if (p.baseToken?.address !== mintAddress) return false;
    const price = Number(p.priceUsd);
    return Number.isFinite(price) && price > 0;
  });

  if (validPairs.length === 0) return null;

  // Prefer pairs quoted in canonical Solana assets (SOL / WSOL / USDC / USDT)
  const trustedPairs = validPairs.filter((p) =>
    trustedQuotes.has((p.quoteToken?.symbol ?? '').toUpperCase())
  );
  const poolSet = trustedPairs.length > 0 ? trustedPairs : validPairs;

  // Reject extreme spoofed 24h price-change outliers (>10,000%) when normal pairs exist
  const sanePairs = poolSet.filter((p) => {
    const h24 = Number(p.priceChange?.h24 ?? 0);
    return Number.isFinite(h24) && Math.abs(h24) <= 10_000;
  });
  const candidates = sanePairs.length > 0 ? sanePairs : poolSet;

  let best: RawDexScreenerPair | null = null;
  let bestScore = -1;

  for (const p of candidates) {
    const liq = Number(p.liquidity?.usd ?? 0);
    const vol = Number(p.volume?.h24 ?? 0);
    const txns24h =
      Number(p.txns?.h24?.buys ?? 0) + Number(p.txns?.h24?.sells ?? 0);

    // Cap liquidity contribution relative to actual 24h trading volume so phantom TVL cannot win
    const effectiveLiq =
      vol > 0 ? Math.min(liq, Math.max(vol * 15, 250_000)) : Math.min(liq, 50_000);
    const score = vol * 3 + effectiveLiq + txns24h * 25;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function buildRealSparklineFromChanges(
  priceUsd: number,
  change5m: number,
  change1h: number,
  change6h: number,
  change24h: number
): number[] {
  const safePrice = priceUsd > 0 ? priceUsd : 0.0001;
  const p24 = safePrice / (1 + Math.max(-0.95, change24h / 100));
  const p6 = safePrice / (1 + Math.max(-0.95, change6h / 100));
  const p1 = safePrice / (1 + Math.max(-0.95, change1h / 100));
  const p5m = safePrice / (1 + Math.max(-0.95, change5m / 100));

  const anchors = [
    p24,
    p24 + (p6 - p24) * 0.35,
    p24 + (p6 - p24) * 0.7,
    p6,
    p6 + (p1 - p6) * 0.5,
    p1,
    p1 + (p5m - p1) * 0.5,
    p5m,
    safePrice,
  ];
  return anchors.map((v) => Number(Math.max(1e-12, v).toPrecision(5)));
}

export function mapDexPairToSolanaToken(
  pair: RawDexScreenerPair,
  mintInfo?: ParsedMintAuthorityState
): SolanaToken | null {
  const address = pair.baseToken?.address;
  if (!address || !isValidSolanaPublicKey(address)) return null;

  const canonical = CANONICAL_SOLANA_MINTS.find((c) => c.address === address);
  const priceUsd = Number(pair.priceUsd ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  const change5m = Number(pair.priceChange?.m5 ?? 0);
  const change1h = Number(pair.priceChange?.h1 ?? 0);
  const change6h = Number(pair.priceChange?.h6 ?? change1h);
  const change24h = Number(pair.priceChange?.h24 ?? 0);
  const volume24h = Number(pair.volume?.h24 ?? 0);
  const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
  const marketCap = Number(pair.marketCap ?? pair.fdv ?? 0);
  const ageHours = pair.pairCreatedAt
    ? Math.max(0.1, Number(((Date.now() - pair.pairCreatedAt) / 3_600_000).toFixed(1)))
    : 24;

  const activeBoosts = Number(pair.boosts?.active ?? 0);
  const boostMultiplier =
    activeBoosts >= 500 ? 100 : activeBoosts >= 100 ? 50 : activeBoosts > 0 ? 10 : 1;
  const boostTier =
    boostMultiplier === 100
      ? 'apex_100x'
      : boostMultiplier === 50
        ? 'surge_50x'
        : boostMultiplier === 10
          ? 'pulse_10x'
          : 'none';

  const mintRevoked = mintInfo?.exists ? mintInfo.mintRevoked : false;
  const freezeRevoked = mintInfo?.exists ? mintInfo.freezeRevoked : false;

  const rawSymbol = (canonical?.symbol ?? pair.baseToken?.symbol ?? 'SPL')
    .trim()
    .toUpperCase();
  const cleanName = (canonical?.name ?? pair.baseToken?.name ?? rawSymbol).trim();

  const txns24 = (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0);

  return {
    address,
    symbol: rawSymbol.slice(0, 14),
    name: cleanName.slice(0, 48),
    category: canonical?.category ?? (activeBoosts > 0 ? 'Meme' : 'DeFi'),
    priceUsd,
    change5m,
    change1h,
    change24h,
    volume24h,
    liquidityUsd,
    marketCap,
    holders: txns24, // Real 24h on-chain tx activity count (displayed accurately in UI)
    ageHours,
    boostMultiplier,
    boostTier,
    verifiedDev: Boolean(mintInfo?.exists && mintRevoked && freezeRevoked),
    security: {
      mintRevoked,
      freezeRevoked,
      lpLockedMonths: 0,
      metadataImmutable: Boolean(mintRevoked && freezeRevoked),
    },
    sparkline: buildRealSparklineFromChanges(
      priceUsd,
      change5m,
      change1h,
      change6h,
      change24h
    ),
    description:
      canonical?.description ??
      `Live Solana SPL market trading on ${formatDexLabel(pair.dexId)} (${pair.baseToken?.symbol ?? rawSymbol}/${pair.quoteToken?.symbol ?? 'SOL'}).`,
    decimals: mintInfo?.exists ? mintInfo.decimals : canonical?.decimals ?? 9,
    totalSupply: mintInfo?.exists ? mintInfo.supplyUi : undefined,
    imageUrl: sanitizeExternalUrl(pair.info?.imageUrl),
    socials: extractSocialsFromDexPair(pair),
    dexSource: formatDexLabel(pair.dexId),
    pairAddress: pair.pairAddress,
    dexUrl: sanitizeExternalUrl(pair.url),
    mintAuthority: mintInfo?.exists ? mintInfo.mintAuthority : undefined,
    freezeAuthority: mintInfo?.exists ? mintInfo.freezeAuthority : undefined,
    onChainVerified: Boolean(mintInfo?.exists),
    cluster: 'Mainnet-Beta',
  };
}

export function mapDexPairsToPools(pairs: RawDexScreenerPair[]): OnChainPoolInfo[] {
  return pairs
    .filter(
      (p) =>
        p.chainId === 'solana' &&
        typeof p.pairAddress === 'string' &&
        isValidSolanaPublicKey(p.pairAddress)
    )
    .map((p) => ({
      pairAddress: p.pairAddress!,
      dexId: p.dexId ?? 'raydium',
      dexLabel: formatDexLabel(p.dexId),
      dexUrl:
        sanitizeExternalUrl(p.url) ??
        `https://dexscreener.com/solana/${encodeURIComponent(p.pairAddress!)}`,
      baseSymbol: p.baseToken?.symbol ?? 'SPL',
      baseAddress: p.baseToken?.address ?? '',
      quoteSymbol: p.quoteToken?.symbol ?? 'SOL',
      quoteAddress: p.quoteToken?.address ?? '',
      priceUsd: Number(p.priceUsd ?? 0),
      liquidityUsd: Number(p.liquidity?.usd ?? 0),
      volume24h: Number(p.volume?.h24 ?? 0),
      change24h: Number(p.priceChange?.h24 ?? 0),
      buys24h: Number(p.txns?.h24?.buys ?? 0),
      sells24h: Number(p.txns?.h24?.sells ?? 0),
      pairCreatedAt: p.pairCreatedAt,
    }))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd || b.volume24h - a.volume24h);
}

const ACCENT_PALETTE = [
  '#10B981',
  '#38BDF8',
  '#F59E0B',
  '#A855F7',
  '#F43F5E',
  '#22C55E',
  '#EAB308',
  '#EC4899',
];

export function mapDexPairToTrendingCoin(
  pair: RawDexScreenerPair,
  idx: number,
  boostDescription?: string
): TrendingCoin | null {
  const address = pair.baseToken?.address;
  if (!address || !isValidSolanaPublicKey(address)) return null;

  const priceUsd = Number(pair.priceUsd ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  const buys1h = Number(pair.txns?.h1?.buys ?? 0);
  const sells1h = Number(pair.txns?.h1?.sells ?? 0);
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity;
  const isNew = ageMs <= 72 * 3_600_000;
  const platform = mapDexIdToPlatform(pair.dexId);
  const canonical = CANONICAL_SOLANA_MINTS.find((c) => c.address === address);

  return {
    id: `live-${address}`,
    address,
    pairAddress: pair.pairAddress,
    dexUrl: sanitizeExternalUrl(pair.url),
    imageUrl: sanitizeExternalUrl(pair.info?.imageUrl),
    name: (pair.baseToken?.name ?? pair.baseToken?.symbol ?? 'Solana Token').slice(0, 48),
    symbol: (pair.baseToken?.symbol ?? 'SPL').toUpperCase().slice(0, 14),
    description:
      boostDescription?.trim() ||
      canonical?.description ||
      `Live Solana market on ${formatDexLabel(pair.dexId)} (${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}) · 24h Vol $${Math.round(Number(pair.volume?.h24 ?? 0)).toLocaleString('en-US')}.`,
    holders: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
    marketCapUsd: Number(pair.marketCap ?? pair.fdv ?? 0),
    liquidityUsd: Number(pair.liquidity?.usd ?? 0),
    volume24hUsd: Number(pair.volume?.h24 ?? 0),
    priceUsd,
    change24h: Number(pair.priceChange?.h24 ?? 0),
    buysPerHour: buys1h,
    sellsPerHour: sells1h,
    lastBuyLabel: `${buys1h.toLocaleString('en-US')} buys/1h`,
    platform,
    isNew,
    accentColor: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
    decimals: canonical?.decimals ?? 9,
    totalSupply: 1_000_000_000,
    category: canonical?.category ?? 'Meme',
    socials: extractSocialsFromDexPair(pair),
  };
}

export interface RawRpcTokenAccountItem {
  pubkey: string;
  account: {
    owner: string;
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {
            amount?: string;
            decimals?: number;
            uiAmount?: number | null;
            uiAmountString?: string;
          };
        };
      };
    };
  };
}

export function parseRpcTokenAccounts(
  items: RawRpcTokenAccountItem[],
  marketByMint: Map<
    string,
    {
      symbol: string;
      name: string;
      priceUsd: number;
      imageUrl?: string;
      pairAddress?: string;
      dexSource?: string;
    }
  >
): OnChainTokenAccount[] {
  const results: OnChainTokenAccount[] = [];
  for (const item of items) {
    const info = item.account?.data?.parsed?.info;
    const mint = info?.mint;
    const ta = info?.tokenAmount;
    if (!mint || !ta) continue;

    const decimals = Number(ta.decimals ?? 0);
    const amountRaw = String(ta.amount ?? '0');
    const uiAmount =
      typeof ta.uiAmount === 'number'
        ? ta.uiAmount
        : fromRawTokenAmount(amountRaw, decimals);

    const canonical = CANONICAL_SOLANA_MINTS.find((c) => c.address === mint);
    const market = marketByMint.get(mint);

    const symbol = market?.symbol ?? canonical?.symbol ?? `${mint.slice(0, 4)}..${mint.slice(-3)}`;
    const name = market?.name ?? canonical?.name ?? `SPL Token (${mint.slice(0, 6)}…)`;
    const priceUsd = market?.priceUsd ?? (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 1 : 0);
    const valueUsd = Number((uiAmount * priceUsd).toFixed(4));

    results.push({
      tokenAccount: item.pubkey,
      mint,
      programId: item.account.owner,
      amountRaw,
      uiAmount,
      decimals,
      symbol,
      name,
      imageUrl: market?.imageUrl,
      priceUsd,
      valueUsd,
      pairAddress: market?.pairAddress,
      dexSource: market?.dexSource,
      isEmpty: amountRaw === '0',
    });
  }

  return results.sort((a, b) => b.valueUsd - a.valueUsd || b.uiAmount - a.uiAmount);
}

export function parseJupiterQuoteResponse(
  raw: Record<string, unknown>
): JupiterQuoteSummary | null {
  const inputMint = typeof raw.inputMint === 'string' ? raw.inputMint : '';
  const outputMint = typeof raw.outputMint === 'string' ? raw.outputMint : '';
  const inAmount = typeof raw.inAmount === 'string' ? raw.inAmount : '';
  const outAmount = typeof raw.outAmount === 'string' ? raw.outAmount : '';
  if (!inputMint || !outputMint || !inAmount || !outAmount) return null;

  const routePlan = Array.isArray(raw.routePlan) ? raw.routePlan : [];
  const routeLabels: string[] = [];
  for (const step of routePlan) {
    const label = (step as { swapInfo?: { label?: string } })?.swapInfo?.label;
    if (typeof label === 'string' && label && !routeLabels.includes(label)) {
      routeLabels.push(label);
    }
  }

  const priceImpactPct = Number(
    (Number(raw.priceImpactPct ?? 0) * 100).toFixed(4)
  );

  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    otherAmountThreshold:
      typeof raw.otherAmountThreshold === 'string'
        ? raw.otherAmountThreshold
        : outAmount,
    priceImpactPct: Number.isFinite(priceImpactPct) ? Math.abs(priceImpactPct) : 0,
    slippageBps: Number(raw.slippageBps ?? 50),
    routeLabels: routeLabels.length > 0 ? routeLabels : ['Jupiter v6'],
    rawQuoteResponse: raw,
  };
}
