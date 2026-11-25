import type {
  AlertMetric,
  AlertRule,
  BoostTierId,
  ChainId,
  LaunchFormInput,
  SolanaCluster,
  SolanaToken,
  TriggeredAlert,
} from '../types/solana';
import { BOOST_TIERS, CANONICAL_SOLANA_MINTS } from '../data/seedData';

export type { SolanaCluster };

export type TokenFilterTab =
  | 'all'
  | 'gainers'
  | 'boosted'
  | 'new_pairs'
  | 'verified';

export type TokenSortKey =
  | 'change24h'
  | 'change1h'
  | 'volume24h'
  | 'liquidityUsd'
  | 'boostMultiplier'
  | 'marketCap';

export interface FilterTokensOptions {
  search: string;
  tab: TokenFilterTab;
  sortBy: TokenSortKey;
}

export function filterAndSortTokens(
  tokens: SolanaToken[],
  options: FilterTokensOptions
): SolanaToken[] {
  const query = options.search.trim().toLowerCase();

  const filtered = tokens.filter((token) => {
    if (query) {
      const matches =
        token.symbol.toLowerCase().includes(query) ||
        token.name.toLowerCase().includes(query) ||
        token.address.toLowerCase().includes(query) ||
        token.category.toLowerCase().includes(query);
      if (!matches) return false;
    }

    switch (options.tab) {
      case 'gainers':
        return token.change24h > 0;
      case 'boosted':
        return token.boostMultiplier > 1;
      case 'new_pairs':
        return token.ageHours <= 48 || Boolean(token.launchedByUser);
      case 'verified':
        return (
          token.security.mintRevoked &&
          token.security.freezeRevoked
        );
      case 'all':
      default:
        return true;
    }
  });

  return [...filtered].sort((a, b) => {
    const diff = b[options.sortBy] - a[options.sortBy];
    if (diff !== 0) return diff;
    return b.volume24h - a.volume24h;
  });
}

export interface SwapQuoteInput {
  fromChain: ChainId;
  toChain: ChainId;
  fromSymbol: string;
  toSymbol: string;
  fromPriceUsd: number;
  toPriceUsd: number;
  amount: number;
  slippagePct: number;
  mevProtected: boolean;
  availableBalance: number;
}

export interface SwapQuoteResult {
  valid: boolean;
  error?: string;
  estimatedOutput: number;
  minimumReceived: number;
  exchangeRate: number;
  feeUsd: number;
  priceImpactPct: number;
  routeProvider: string;
  estimatedSeconds: number;
}

export function computeSwapQuote(input: SwapQuoteInput): SwapQuoteResult {
  const isCrossChain = input.fromChain !== input.toChain;
  const routeProvider = isCrossChain
    ? 'Wormhole Mayan Swift + Jupiter v6'
    : input.fromChain === 'solana'
      ? input.mevProtected
        ? 'Jupiter v6 via Priority Relay'
        : 'Jupiter v6 Aggregator'
      : '1inch Cross-Pool Router';

  const estimatedSeconds = isCrossChain
    ? 18
    : input.fromChain === 'solana'
      ? 1
      : 10;

  if (input.fromSymbol === input.toSymbol && input.fromChain === input.toChain) {
    return {
      valid: false,
      error: 'Select two different assets to swap.',
      estimatedOutput: 0,
      minimumReceived: 0,
      exchangeRate: 1,
      feeUsd: 0,
      priceImpactPct: 0,
      routeProvider,
      estimatedSeconds,
    };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return {
      valid: false,
      error: 'Enter an amount greater than 0.',
      estimatedOutput: 0,
      minimumReceived: 0,
      exchangeRate: input.toPriceUsd > 0 ? input.fromPriceUsd / input.toPriceUsd : 0,
      feeUsd: 0,
      priceImpactPct: 0,
      routeProvider,
      estimatedSeconds,
    };
  }

  if (input.fromPriceUsd <= 0 || input.toPriceUsd <= 0) {
    return {
      valid: false,
      error: 'Live pricing unavailable for selected pair.',
      estimatedOutput: 0,
      minimumReceived: 0,
      exchangeRate: 0,
      feeUsd: 0,
      priceImpactPct: 0,
      routeProvider,
      estimatedSeconds,
    };
  }

  const notionalUsd = input.amount * input.fromPriceUsd;
  const feeRate = isCrossChain ? 0.0025 : 0.001;
  const feeUsd = notionalUsd * feeRate;
  const priceImpactPct = Math.min(
    4.5,
    Number(((notionalUsd / 2500000) * 0.45 + (isCrossChain ? 0.08 : 0.02)).toFixed(3))
  );

  const netUsd = Math.max(0, notionalUsd - feeUsd) * (1 - priceImpactPct / 100);
  const estimatedOutput = netUsd / input.toPriceUsd;
  const slippageClamped = Math.max(0.05, Math.min(15, input.slippagePct));
  const minimumReceived = estimatedOutput * (1 - slippageClamped / 100);
  const exchangeRate = input.fromPriceUsd / input.toPriceUsd;

  if (input.amount > input.availableBalance) {
    return {
      valid: false,
      error: `Insufficient ${input.fromSymbol} balance.`,
      estimatedOutput,
      minimumReceived,
      exchangeRate,
      feeUsd,
      priceImpactPct,
      routeProvider,
      estimatedSeconds,
    };
  }

  return {
    valid: true,
    estimatedOutput,
    minimumReceived,
    exchangeRate,
    feeUsd,
    priceImpactPct,
    routeProvider,
    estimatedSeconds,
  };
}

export interface LaunchValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  normalizedSymbol: string;
  securityScore: number;
  authorityFeesSol: number;
  creatorFeeSol: number;
  boostCostSol: number;
  boostMultiplier: number;
  estimatedRentSol: number;
  totalDeployCostSol: number;
  estimatedInitialMarketCapUsd: number;
}

// Real Solana on-chain SPL rent & network fees (~0.00146 SOL Mint + ~0.00204 SOL ATA + ~0.00001 SOL tx fee)
export const BASE_DEPLOY_FEE_SOL = 0.0036;
export const AUTHORITY_REVOKE_FEE_SOL = 0;
export const MODIFY_CREATOR_FEE_SOL = 0;

export function getBoostSpec(tierId: BoostTierId) {
  if (tierId === 'none') {
    return { costSol: 0, multiplier: 1, name: 'Standard Listing' };
  }
  const found = BOOST_TIERS.find((t) => t.id === tierId);
  if (!found) {
    return { costSol: 0, multiplier: 1, name: 'Standard Listing' };
  }
  return {
    costSol: found.costSol,
    multiplier: found.multiplier,
    name: found.name,
  };
}

export function validateLaunchForm(
  input: LaunchFormInput,
  solPriceUsd = 150
): LaunchValidationResult {
  const errors: Record<string, string> = {};
  const trimmedName = input.name.trim();
  const normalizedSymbol = input.symbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (trimmedName.length < 2 || trimmedName.length > 36) {
    errors.name = 'Token name must be between 2 and 36 characters.';
  }

  if (normalizedSymbol.length < 2 || normalizedSymbol.length > 10) {
    errors.symbol = 'Ticker symbol must be 2 to 10 letters or numbers.';
  }

  if (
    !Number.isInteger(input.decimals) ||
    input.decimals < 0 ||
    input.decimals > 9
  ) {
    errors.decimals = 'Decimals must be a whole number from 0 to 9.';
  }

  if (input.description.trim().length < 10) {
    errors.description = 'Add a project description (at least 10 characters).';
  }

  // Max uint64 supply check: totalSupply * 10^decimals <= 2^64 - 1 (~1.84e19)
  const maxSafeSupplyForDecimals = Math.floor(1.8e19 / Math.pow(10, Math.max(0, Math.min(9, input.decimals))));
  if (
    !Number.isFinite(input.totalSupply) ||
    input.totalSupply < 1000 ||
    input.totalSupply > Math.min(1e15, maxSafeSupplyForDecimals)
  ) {
    errors.totalSupply = `Total supply must be between 1,000 and ${Math.min(1e15, maxSafeSupplyForDecimals).toLocaleString('en-US')} for ${input.decimals} decimals (SPL u64 limit).`;
  }

  if (
    !Number.isFinite(input.initialLpSol) ||
    input.initialLpSol < 0 ||
    input.initialLpSol > 50000
  ) {
    errors.initialLpSol = 'Planned Raydium/Meteora LP must be between 0 and 50,000 SOL.';
  }

  if (input.modifyCreator && !(input.creatorName ?? '').trim()) {
    errors.creatorName = 'Enter a custom creator name or disable Modify Creator.';
  }

  let securityScore = 15;
  if (input.mintRevoked) securityScore += 35;
  if (input.freezeRevoked) securityScore += 30;
  if (input.metadataImmutable) securityScore += 10;
  if (input.lpLockedMonths >= 12) securityScore += 10;
  else if (input.lpLockedMonths >= 3) securityScore += 5;

  const authorityFeesSol = 0;
  const creatorFeeSol = 0;
  const estimatedRentSol = BASE_DEPLOY_FEE_SOL;
  const boost = getBoostSpec(input.boostTier);
  const totalDeployCostSol = Number(
    (estimatedRentSol + boost.costSol).toFixed(4)
  );
  const effectiveLpSol = Math.max(0, input.initialLpSol);
  const estimatedInitialMarketCapUsd =
    effectiveLpSol > 0 ? Math.round(effectiveLpSol * solPriceUsd * 2) : 0;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalizedSymbol,
    securityScore,
    authorityFeesSol,
    creatorFeeSol,
    boostCostSol: boost.costSol,
    boostMultiplier: boost.multiplier,
    estimatedRentSol,
    totalDeployCostSol,
    estimatedInitialMarketCapUsd,
  };
}

export interface LiquidityPoolQuoteInput {
  dex: 'Raydium' | 'Meteora';
  baseAmount: number;
  quoteAmount: number;
  quoteSymbol: 'SOL' | 'USDC';
  solPriceUsd: number;
  feeTierPct: number;
  availableQuoteBalance: number;
}

export interface LiquidityPoolQuoteResult {
  valid: boolean;
  error?: string;
  initialTokenPriceUsd: number;
  tvlUsd: number;
  lpTokensMinted: number;
  poolCreationFeeSol: number;
}

export function computeLiquidityPoolQuote(
  input: LiquidityPoolQuoteInput
): LiquidityPoolQuoteResult {
  const poolCreationFeeSol = input.dex === 'Raydium' ? 0.2 : 0.15;
  if (!Number.isFinite(input.baseAmount) || input.baseAmount <= 0) {
    return {
      valid: false,
      error: 'Enter a base token deposit amount greater than 0.',
      initialTokenPriceUsd: 0,
      tvlUsd: 0,
      lpTokensMinted: 0,
      poolCreationFeeSol,
    };
  }
  if (!Number.isFinite(input.quoteAmount) || input.quoteAmount <= 0) {
    return {
      valid: false,
      error: `Enter a ${input.quoteSymbol} liquidity deposit greater than 0.`,
      initialTokenPriceUsd: 0,
      tvlUsd: 0,
      lpTokensMinted: 0,
      poolCreationFeeSol,
    };
  }
  if (input.quoteAmount > input.availableQuoteBalance) {
    return {
      valid: false,
      error: `Insufficient ${input.quoteSymbol} balance for pool deposit.`,
      initialTokenPriceUsd: 0,
      tvlUsd: 0,
      lpTokensMinted: 0,
      poolCreationFeeSol,
    };
  }

  const quoteUsd =
    input.quoteSymbol === 'SOL'
      ? input.quoteAmount * input.solPriceUsd
      : input.quoteAmount;
  const tvlUsd = Number((quoteUsd * 2).toFixed(2));
  const initialTokenPriceUsd = quoteUsd / input.baseAmount;
  const lpTokensMinted = Number(
    Math.sqrt(input.baseAmount * input.quoteAmount).toFixed(4)
  );

  return {
    valid: true,
    initialTokenPriceUsd,
    tvlUsd,
    lpTokensMinted,
    poolCreationFeeSol,
  };
}

export function validateAlertInput(
  tokenSymbol: string,
  metric: AlertMetric,
  threshold: number
): { valid: boolean; error?: string } {
  if (!tokenSymbol.trim()) {
    return { valid: false, error: 'Select a Solana token.' };
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { valid: false, error: 'Threshold must be a positive number.' };
  }
  if (metric === 'change1h_above' && threshold > 1000) {
    return { valid: false, error: '1h percentage threshold cannot exceed 1000%.' };
  }
  return { valid: true };
}

export function evaluateAlertRules(
  rules: AlertRule[],
  tokens: SolanaToken[],
  existingTriggered: TriggeredAlert[]
): {
  newlyTriggered: TriggeredAlert[];
  updatedRules: AlertRule[];
} {
  const tokenMap = new Map(tokens.map((t) => [t.symbol.toUpperCase(), t]));
  const alreadyOpenKeys = new Set(
    existingTriggered
      .filter((a) => !a.acknowledged)
      .map((a) => `${a.ruleId}:${a.tokenSymbol}`)
  );

  const newlyTriggered: TriggeredAlert[] = [];
  const nowIso = new Date().toISOString();

  const updatedRules = rules.map((rule) => {
    if (!rule.active) return rule;
    const token = tokenMap.get(rule.tokenSymbol.toUpperCase());
    if (!token) return rule;

    let matched = false;
    let currentValue = 0;
    let message = '';

    if (rule.metric === 'price_above' && token.priceUsd >= rule.threshold) {
      matched = true;
      currentValue = token.priceUsd;
      message = `${token.symbol} broke above ${formatUsd(rule.threshold)} (now ${formatUsd(token.priceUsd)})`;
    } else if (rule.metric === 'price_below' && token.priceUsd <= rule.threshold) {
      matched = true;
      currentValue = token.priceUsd;
      message = `${token.symbol} dropped below ${formatUsd(rule.threshold)} (now ${formatUsd(token.priceUsd)})`;
    } else if (rule.metric === 'change1h_above' && token.change1h >= rule.threshold) {
      matched = true;
      currentValue = token.change1h;
      message = `${token.symbol} 1h momentum hit ${formatPercent(token.change1h)} (target +${rule.threshold}%)`;
    } else if (rule.metric === 'volume_above' && token.volume24h >= rule.threshold) {
      matched = true;
      currentValue = token.volume24h;
      message = `${token.symbol} 24h volume exceeded ${formatCompactUsd(rule.threshold)} (now ${formatCompactUsd(token.volume24h)})`;
    }

    const dedupeKey = `${rule.id}:${token.symbol}`;
    if (matched && !alreadyOpenKeys.has(dedupeKey)) {
      alreadyOpenKeys.add(dedupeKey);
      newlyTriggered.push({
        id: `trig-${rule.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ruleId: rule.id,
        tokenSymbol: token.symbol,
        message,
        currentValue,
        triggeredAt: nowIso,
        acknowledged: false,
      });
      return {
        ...rule,
        triggeredCount: rule.triggeredCount + 1,
        lastTriggeredAt: nowIso,
      };
    }

    return rule;
  });

  return { newlyTriggered, updatedRules };
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  if (value >= 1000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  if (value >= 0.0001) {
    return `$${value.toFixed(6)}`;
  }
  return `$${value.toFixed(8)}`;
}

export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export interface DexPairCandidate {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  baseToken?: { address?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
}

const TRUSTED_SOLANA_QUOTES = new Set(['SOL', 'WSOL', 'USDC', 'USDT']);

export function selectLegitimateDexPair(
  pairs: DexPairCandidate[],
  tokenAddress: string,
  referencePriceUsd = 0
): DexPairCandidate | null {
  let best: DexPairCandidate | null = null;
  let bestVolume = -1;

  for (const pair of pairs) {
    if (pair.chainId !== 'solana') continue;
    if (pair.baseToken?.address !== tokenAddress) continue;

    const quoteSymbol = (pair.quoteToken?.symbol ?? '').toUpperCase();
    if (!TRUSTED_SOLANA_QUOTES.has(quoteSymbol)) continue;

    const price = Number(pair.priceUsd);
    if (!Number.isFinite(price) || price <= 0) continue;

    const vol24h = pair.volume?.h24 ?? 0;
    const liqUsd = pair.liquidity?.usd ?? 0;
    if (liqUsd < 1000 && vol24h < 1000) continue;

    const change24h = pair.priceChange?.h24 ?? 0;
    if (!Number.isFinite(change24h) || Math.abs(change24h) > 50000) continue;

    if (
      referencePriceUsd > 0 &&
      (price > referencePriceUsd * 4 || price < referencePriceUsd * 0.2)
    ) {
      continue;
    }

    if (vol24h > bestVolume) {
      bestVolume = vol24h;
      best = pair;
    }
  }

  return best;
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
export const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const KNOWN_SOLANA_MINTS: Record<string, string> = Object.fromEntries([
  ['WSOL', SOL_MINT_ADDRESS],
  ...CANONICAL_SOLANA_MINTS.map((m) => [m.symbol, m.address]),
]);

function withSolscanCluster(url: string, network?: SolanaCluster): string {
  return network === 'Devnet' ? `${url}?cluster=devnet` : url;
}

export function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value.trim());
}

export function getSolscanTokenUrl(
  address: string,
  network?: SolanaCluster
): string {
  const clean = encodeURIComponent(address.trim());
  return withSolscanCluster(`https://solscan.io/token/${clean}`, network);
}

export function getSolscanAccountUrl(
  address: string,
  network?: SolanaCluster
): string {
  const clean = encodeURIComponent(address.trim());
  return withSolscanCluster(`https://solscan.io/account/${clean}`, network);
}

export function getSolscanTxUrl(
  txHash: string,
  network?: SolanaCluster
): string {
  const clean = encodeURIComponent(txHash.trim());
  return withSolscanCluster(`https://solscan.io/tx/${clean}`, network);
}

export function getDexScreenerTokenUrl(
  addressOrSymbol: string,
  pairAddress?: string
): string {
  if (pairAddress && isLikelySolanaAddress(pairAddress)) {
    return `https://dexscreener.com/solana/${encodeURIComponent(pairAddress.trim())}`;
  }
  const trimmed = addressOrSymbol.trim();
  if (isLikelySolanaAddress(trimmed)) {
    return `https://dexscreener.com/solana/${encodeURIComponent(trimmed)}`;
  }
  return `https://dexscreener.com/solana?q=${encodeURIComponent(trimmed)}`;
}

export function getRaydiumSwapUrl(tokenAddress: string): string {
  const trimmed = tokenAddress.trim();
  if (!trimmed || trimmed === SOL_MINT_ADDRESS) {
    return `https://raydium.io/swap/?inputMint=sol&outputMint=${USDC_MINT_ADDRESS}`;
  }
  return `https://raydium.io/swap/?inputMint=sol&outputMint=${encodeURIComponent(trimmed)}`;
}

export function getRaydiumPoolUrl(tokenAddress: string): string {
  const trimmed = tokenAddress.trim();
  if (!trimmed) return 'https://raydium.io/liquidity-pools/';
  return `https://raydium.io/liquidity-pools/?token=${encodeURIComponent(trimmed)}`;
}

export function getRaydiumCreatePoolUrl(): string {
  return 'https://raydium.io/liquidity/create-pool/';
}

export function getMeteoraPoolUrl(tokenAddress: string): string {
  const trimmed = tokenAddress.trim();
  if (!trimmed) return 'https://app.meteora.ag/dlmm';
  return `https://app.meteora.ag/dlmm?search=${encodeURIComponent(trimmed)}`;
}

export function getMeteoraCreatePoolUrl(): string {
  return 'https://app.meteora.ag/pools/create';
}

export interface TokenExternalLinks {
  solscan: string;
  dexscreener: string;
  raydiumSwap: string;
  raydiumPools: string;
  meteoraPools: string;
}

export function getTokenExternalLinks(
  tokenAddress: string,
  network?: SolanaCluster,
  pairAddress?: string
): TokenExternalLinks {
  return {
    solscan: getSolscanTokenUrl(tokenAddress, network),
    dexscreener: getDexScreenerTokenUrl(tokenAddress, pairAddress),
    raydiumSwap: getRaydiumSwapUrl(tokenAddress),
    raydiumPools: getRaydiumPoolUrl(tokenAddress),
    meteoraPools: getMeteoraPoolUrl(tokenAddress),
  };
}

export function resolveTokenAddressBySymbol(
  symbol: string,
  tokens: Array<{ symbol: string; address: string }>
): string | null {
  const normalized = symbol.trim().replace(/^\$/, '').replace(/-LP$/i, '').toUpperCase();
  if (!normalized) return null;
  const fromLive = tokens.find((t) => t.symbol.toUpperCase() === normalized);
  if (fromLive?.address) return fromLive.address;
  return KNOWN_SOLANA_MINTS[normalized] ?? null;
}
