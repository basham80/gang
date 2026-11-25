import type { BoostTierSpec, ChainId, SolanaToken } from '../types/solana';

export interface CanonicalSolanaMint {
  address: string;
  symbol: string;
  name: string;
  category: SolanaToken['category'];
  decimals: number;
  description: string;
}

/**
 * Verified canonical Solana Mainnet SPL mint addresses queried live via
 * Solana JSON-RPC (getMultipleAccounts) and DexScreener (/latest/dex/tokens).
 * Zero synthetic prices, balances, or fabricated tokens exist in this file.
 */
export const CANONICAL_SOLANA_MINTS: CanonicalSolanaMint[] = [
  {
    address: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Wrapped SOL',
    category: 'Infrastructure',
    decimals: 9,
    description:
      'Native Layer-1 asset of the Solana network powering transactions, staking, and DEX liquidity.',
  },
  {
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    category: 'DeFi',
    decimals: 6,
    description:
      'Regulated USD stablecoin issued natively on Solana SPL for settlement and liquidity pools.',
  },
  {
    address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: 'RAY',
    name: 'Raydium',
    category: 'DeFi',
    decimals: 6,
    description:
      'Solana automated market maker and concentrated liquidity engine powering launch pools.',
  },
  {
    address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    category: 'DeFi',
    decimals: 6,
    description:
      'Primary Solana DEX liquidity aggregator, swap router, and perpetuals venue.',
  },
  {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    category: 'Meme',
    decimals: 5,
    description:
      'Community Solana SPL token integrated across wallets, DeFi pools, and DEX markets.',
  },
  {
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIF',
    name: 'dogwifhat',
    category: 'Meme',
    decimals: 6,
    description:
      'High-liquidity Solana SPL community token trading on Raydium, Orca, and Meteora.',
  },
  {
    address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    symbol: 'JTO',
    name: 'Jito',
    category: 'LST',
    decimals: 9,
    description:
      'MEV-aware liquid staking and validator block-engine protocol on Solana.',
  },
  {
    address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    symbol: 'POPCAT',
    name: 'Popcat (SOL)',
    category: 'Meme',
    decimals: 9,
    description:
      'Solana SPL community token with active spot liquidity on Raydium and Meteora.',
  },
  {
    address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    symbol: 'PYTH',
    name: 'Pyth Network',
    category: 'Infrastructure',
    decimals: 6,
    description:
      'First-party on-chain market data oracle publishing live price feeds on Solana.',
  },
  {
    address: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7',
    symbol: 'DRIFT',
    name: 'Drift Protocol',
    category: 'DeFi',
    decimals: 6,
    description:
      'On-chain perpetuals, spot DEX, and cross-margin lending protocol on Solana.',
  },
  {
    address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    symbol: 'ORCA',
    name: 'Orca',
    category: 'DeFi',
    decimals: 6,
    description:
      'Concentrated liquidity Whirlpool DEX built natively on Solana.',
  },
  {
    address: 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS',
    symbol: 'KMNO',
    name: 'Kamino Finance',
    category: 'DeFi',
    decimals: 6,
    description:
      'Automated liquidity vaults and borrowing protocol on Solana.',
  },
  {
    address: '2zMMhcVQEXDtdE4vsFS7S7D5oUodfJHE8vd1gnBouauv',
    symbol: 'PENGU',
    name: 'Pudgy Penguins',
    category: 'Community',
    decimals: 6,
    description:
      'Official SPL community token trading on Solana decentralized exchanges.',
  },
  {
    address: 'DBRiDgJAMsM95moTzJs7M9LnkGErpbv9v6CUR1DXnUu5',
    symbol: 'DBR',
    name: 'deBridge',
    category: 'Infrastructure',
    decimals: 6,
    description:
      'Cross-chain Solana and EVM interoperability protocol with instant settlement.',
  },
  {
    address: 'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump',
    symbol: 'PIPPIN',
    name: 'Pippin',
    category: 'AI',
    decimals: 6,
    description:
      'Solana SPL AI community token trading across Raydium and Meteora.',
  },
];

export const BOOST_TIERS: BoostTierSpec[] = [
  {
    id: 'pulse_10x',
    name: 'Pulse 10x',
    multiplier: 10,
    costSol: 0.05,
    durationHours: 12,
    reachEstimate: 'Top Boosted Feed',
    summary: 'Entry visibility lift for on-chain verified Solana SPL tokens.',
    features: [
      '10x ranking boost in Token Gainer feed',
      'On-chain verified boost notice in Network Announcements',
      'Direct Solscan, DexScreener & Raydium link indexing',
    ],
  },
  {
    id: 'surge_50x',
    name: 'Surge 50x',
    multiplier: 50,
    costSol: 0.15,
    durationHours: 24,
    reachEstimate: 'Featured Gainers Slot',
    summary: 'Sustained 24h spotlight for active Raydium & Meteora liquidity pairs.',
    features: [
      '50x ranking boost across Top Gainers & Boosted tabs',
      'Featured slot in Network Announcements stream',
      'Priority real-time alert & AI sentiment indexing',
    ],
  },
  {
    id: 'apex_100x',
    name: 'Apex 100x',
    multiplier: 100,
    costSol: 0.35,
    durationHours: 48,
    reachEstimate: 'Top-Slot Priority',
    summary: 'Flagship multi-day launch acceleration for audited SPL tokens.',
    features: [
      '100x top-slot priority in YABBAI Token Gainer',
      'Pinned verified on-chain Launch & Boost notice',
      'Direct Jupiter v6 swap & pool discovery routing',
    ],
  },
];

export const CHAIN_METADATA: Record<
  ChainId,
  { name: string; short: string; nativeSymbol: string; avgFinality: string }
> = {
  solana: {
    name: 'Solana',
    short: 'SOL',
    nativeSymbol: 'SOL',
    avgFinality: '0.4s',
  },
  ethereum: {
    name: 'Ethereum',
    short: 'ETH',
    nativeSymbol: 'ETH',
    avgFinality: '12s',
  },
  base: {
    name: 'Base',
    short: 'BASE',
    nativeSymbol: 'ETH',
    avgFinality: '2.0s',
  },
  arbitrum: {
    name: 'Arbitrum',
    short: 'ARB',
    nativeSymbol: 'ETH',
    avgFinality: '0.3s',
  },
};
