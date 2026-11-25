export type AppSection =
  | 'gainer'
  | 'launchpad'
  | 'liquidity'
  | 'trade'
  | 'transactions'
  | 'xtracker'
  | 'announcements'
  | 'alerts';

export type ChainId = 'solana' | 'ethereum' | 'base' | 'arbitrum';

export type SolanaCluster = 'Mainnet-Beta' | 'Devnet';

export type BoostTierId = 'none' | 'pulse_10x' | 'surge_50x' | 'apex_100x';

export type RiskProfile = 'Conservative' | 'Balanced' | 'Aggressive';

export type LaunchPlatform =
  | 'pump.fun'
  | 'Raydium'
  | 'Meteora'
  | 'Orca'
  | 'PumpSwap';

export type LiquidityDex = 'Raydium' | 'Meteora';

export type TransactionType =
  | 'SWAP'
  | 'LAUNCH'
  | 'BOOST'
  | 'POOL_CREATE'
  | 'POOL_BURN'
  | 'POOL_REMOVE'
  | 'TRANSFER'
  | 'WITHDRAW'
  | 'BURN'
  | 'AIRDROP'
  | 'TOP_UP';

export interface AuthUserSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface TokenSocials {
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
}

export interface SecurityFlags {
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpLockedMonths: number;
  metadataImmutable: boolean;
}

export interface SolanaToken {
  address: string;
  symbol: string;
  name: string;
  category: 'DeFi' | 'Infrastructure' | 'Meme' | 'AI' | 'LST' | 'Community';
  priceUsd: number;
  change5m: number;
  change1h: number;
  change24h: number;
  volume24h: number;
  liquidityUsd: number;
  marketCap: number;
  holders: number;
  ageHours: number;
  boostMultiplier: number;
  boostTier: BoostTierId;
  verifiedDev: boolean;
  security: SecurityFlags;
  sparkline: number[];
  description: string;
  decimals?: number;
  totalSupply?: number;
  imageUrl?: string;
  socials?: TokenSocials;
  creatorName?: string;
  creatorWebsite?: string;
  launchedByUser?: boolean;
  dexSource?: string;
  pairAddress?: string;
  dexUrl?: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  onChainVerified?: boolean;
  cluster?: SolanaCluster;
  txSignature?: string;
  persistedInDb?: boolean;
}

export interface TrendingCoin {
  id: string;
  address: string;
  pairAddress?: string;
  dexUrl?: string;
  imageUrl?: string;
  name: string;
  symbol: string;
  description: string;
  holders: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number;
  change24h: number;
  buysPerHour: number;
  sellsPerHour: number;
  lastBuyLabel: string;
  platform: LaunchPlatform;
  isNew: boolean;
  accentColor: string;
  decimals: number;
  totalSupply: number;
  category: SolanaToken['category'];
  socials?: TokenSocials;
}

export interface OnChainPoolInfo {
  pairAddress: string;
  dexId: string;
  dexLabel: string;
  dexUrl: string;
  baseSymbol: string;
  baseAddress: string;
  quoteSymbol: string;
  quoteAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  change24h: number;
  buys24h: number;
  sells24h: number;
  pairCreatedAt?: number;
}

export interface OnChainHolderInfo {
  tokenAccount: string;
  amountUi: number;
  pctOfSupply: number;
}

export interface OnChainTokenInspection {
  address: string;
  cluster: SolanaCluster;
  existsOnChain: boolean;
  programId: string | null;
  decimals: number;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  name?: string;
  symbol?: string;
  imageUrl?: string;
  priceUsd: number;
  marketCapUsd: number;
  totalLiquidityUsd: number;
  volume24hUsd: number;
  pools: OnChainPoolInfo[];
  topHolders: OnChainHolderInfo[];
  fetchedAt: string;
}

export interface OnChainTokenAccount {
  tokenAccount: string;
  mint: string;
  programId: string;
  amountRaw: string;
  uiAmount: number;
  decimals: number;
  symbol: string;
  name: string;
  imageUrl?: string;
  priceUsd: number;
  valueUsd: number;
  pairAddress?: string;
  dexSource?: string;
  isEmpty: boolean;
}

export interface OnChainSignatureRecord {
  signature: string;
  slot: number;
  blockTime: number | null;
  timestamp: string;
  status: 'Confirmed' | 'Failed';
  err: boolean | unknown;
  memo: string | null;
  confirmationStatus?: string;
}

export interface WalletOnChainSnapshot {
  address: string;
  cluster: SolanaCluster;
  solLamports?: number;
  solBalance: number;
  solPriceUsd: number;
  solValueUsd: number;
  totalValueUsd: number;
  tokenAccounts: OnChainTokenAccount[];
  recentSignatures: OnChainSignatureRecord[];
  fetchedAt: string;
}

export interface SolanaChainState {
  cluster: SolanaCluster;
  slot: number;
  blockHeight: number;
  epoch: number;
  tps: number | null;
  healthy: boolean;
  rpcEndpointLabel: string;
  fetchedAt: string;
}

export interface JupiterQuoteSummary {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
  rawQuoteResponse: Record<string, unknown>;
}

export interface LiquidityPool {
  id: string;
  dex: LiquidityDex;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  quoteSymbol: 'SOL' | 'USDC';
  baseAmount: number;
  quoteAmount: number;
  initialPriceUsd: number;
  tvlUsd: number;
  feeTierPct: number;
  lpTokens: number;
  lpLockedLabel: string;
  lpBurned: boolean;
  createdAt: string;
}

export interface XTrackerSignal {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
  followersLabel: string;
  cashtag: string;
  tokenName: string;
  tokenAddress?: string;
  pairAddress?: string;
  xUrl?: string;
  twitterUrl?: string;
  content: string;
  sentiment: 'Bullish' | 'Neutral' | 'Alert';
  likes: number;
  reposts: number;
  mentionsVelocity: string;
  postedAt: string;
}

export interface SentimentAnalysis {
  tokenSymbol: string;
  polarity: 'Bullish' | 'Neutral' | 'Cautious' | 'Bearish';
  confidence: number;
  summary: string;
  catalysts: string[];
  risks: string[];
  devHealthAssessment: string;
  personalizedTake: string;
  riskProfile: RiskProfile;
  analyzedAt: string;
  modelUsed: string;
}

export interface PersonalizedBrief {
  riskProfile: RiskProfile;
  headline: string;
  marketPulse: string;
  topPicks: Array<{
    symbol: string;
    thesis: string;
    conviction: 'High' | 'Moderate' | 'Watch';
  }>;
  riskAdvisory: string;
  generatedAt: string;
  modelUsed: string;
}

export type AlertMetric =
  | 'price_above'
  | 'price_below'
  | 'change1h_above'
  | 'volume_above';

export interface AlertRule {
  id: string;
  tokenSymbol: string;
  metric: AlertMetric;
  threshold: number;
  active: boolean;
  createdAt: string;
  triggeredCount: number;
  lastTriggeredAt?: string;
}

export interface TriggeredAlert {
  id: string;
  ruleId: string;
  tokenSymbol: string;
  message: string;
  currentValue: number;
  triggeredAt: string;
  acknowledged: boolean;
}

export type AnnouncementCategory = 'Launch' | 'Boost' | 'Network' | 'Security';

export interface Announcement {
  id: string;
  category: AnnouncementCategory;
  title: string;
  body: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  txSignature?: string;
  author: string;
  walletAddress: string;
  verified: boolean;
  createdAt: string;
  upvotes: number;
  persistedInDb?: boolean;
}

export type WalletProviderId =
  | 'phantom'
  | 'solflare'
  | 'backpack'
  | 'metamask'
  | 'keypair'
  | 'watch'
  | 'sandbox';

export interface WalletState {
  connected: boolean;
  provider: WalletProviderId | null;
  providerLabel: string;
  address: string;
  shortAddress: string;
  network: SolanaCluster;
  balances: Record<string, number>;
  canSign: boolean;
}

export interface SwapRecord {
  id: string;
  fromChain: ChainId;
  toChain: ChainId;
  fromSymbol: string;
  toSymbol: string;
  fromAmount: number;
  toAmount: number;
  priceImpactPct: number;
  routeProvider: string;
  mevProtected: boolean;
  txHash: string;
  status: 'Confirmed' | 'Pending';
  timestamp: string;
}

export interface LedgerTransaction {
  id: string;
  txType: TransactionType;
  fromChain: ChainId;
  toChain: ChainId;
  fromSymbol: string;
  toSymbol: string;
  fromAmount: number;
  toAmount: number;
  feeSol: number;
  priceImpactPct: number;
  routeProvider: string;
  summary: string;
  mevProtected: boolean;
  txHash: string;
  status: 'Confirmed';
  timestamp: string;
  cluster?: SolanaCluster;
  tokenAddress?: string;
}

export interface BoostTierSpec {
  id: Exclude<BoostTierId, 'none'>;
  name: string;
  multiplier: number;
  costSol: number;
  durationHours: number;
  reachEstimate: string;
  summary: string;
  features: string[];
}

export interface LaunchFormInput {
  name: string;
  symbol: string;
  category: SolanaToken['category'];
  description: string;
  decimals: number;
  totalSupply: number;
  initialLpSol: number;
  imageDataUrl?: string;
  imageFileName?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  modifyCreator: boolean;
  creatorName?: string;
  creatorWebsite?: string;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpLockedMonths: number;
  metadataImmutable: boolean;
  boostTier: BoostTierId;
}
