import test from 'node:test';
import assert from 'node:assert/strict';
import type { SolanaToken } from '../types/solana';
import {
  BASE_DEPLOY_FEE_SOL,
  computeLiquidityPoolQuote,
  computeSwapQuote,
  evaluateAlertRules,
  filterAndSortTokens,
  formatCompactUsd,
  formatUsd,
  getDexScreenerTokenUrl,
  getMeteoraCreatePoolUrl,
  getMeteoraPoolUrl,
  getRaydiumCreatePoolUrl,
  getRaydiumPoolUrl,
  getRaydiumSwapUrl,
  getSolscanAccountUrl,
  getSolscanTokenUrl,
  getSolscanTxUrl,
  getTokenExternalLinks,
  resolveTokenAddressBySymbol,
  selectLegitimateDexPair,
  SOL_MINT_ADDRESS,
  USDC_MINT_ADDRESS,
  validateAlertInput,
  validateLaunchForm,
} from './solanaLogic';
import {
  fromRawTokenAmount,
  isValidSolanaPublicKey,
  lamportsToSol,
  mapDexPairsToPools,
  mapDexPairToSolanaToken,
  parseJupiterQuoteResponse,
  parseMintAccountJsonParsed,
  parseRpcTokenAccounts,
  sanitizeExternalUrl,
  selectBestSolanaPair,
  solToLamports,
  toRawTokenAmount,
} from './solanaRpc';

const SAMPLE_LIVE_TOKENS: SolanaToken[] = [
  {
    address: SOL_MINT_ADDRESS,
    symbol: 'SOL',
    name: 'Wrapped SOL',
    category: 'Infrastructure',
    priceUsd: 185.25,
    change5m: 0.4,
    change1h: 1.8,
    change24h: 6.4,
    volume24h: 450_000_000,
    liquidityUsd: 120_000_000,
    marketCap: 88_000_000_000,
    holders: 125000,
    ageHours: 5000,
    boostMultiplier: 1,
    boostTier: 'none',
    verifiedDev: true,
    security: {
      mintRevoked: true,
      freezeRevoked: true,
      lpLockedMonths: 0,
      metadataImmutable: true,
    },
    sparkline: [174, 179, 185.25],
    description: 'Native Solana token.',
  },
  {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    category: 'Meme',
    priceUsd: 0.0000342,
    change5m: 1.2,
    change1h: 4.5,
    change24h: 14.8,
    volume24h: 92_000_000,
    liquidityUsd: 18_000_000,
    marketCap: 2_400_000_000,
    holders: 88000,
    ageHours: 12000,
    boostMultiplier: 50,
    boostTier: 'surge_50x',
    verifiedDev: true,
    security: {
      mintRevoked: true,
      freezeRevoked: true,
      lpLockedMonths: 0,
      metadataImmutable: true,
    },
    sparkline: [0.00003, 0.000032, 0.0000342],
    description: 'Solana community token.',
  },
  {
    address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    category: 'DeFi',
    priceUsd: 0.92,
    change5m: -0.3,
    change1h: -0.8,
    change24h: -2.1,
    volume24h: 64_000_000,
    liquidityUsd: 35_000_000,
    marketCap: 1_250_000_000,
    holders: 42000,
    ageHours: 8000,
    boostMultiplier: 1,
    boostTier: 'none',
    verifiedDev: true,
    security: {
      mintRevoked: true,
      freezeRevoked: true,
      lpLockedMonths: 0,
      metadataImmutable: true,
    },
    sparkline: [0.95, 0.93, 0.92],
    description: 'Solana DEX aggregator.',
  },
];

test('filterAndSortTokens filters by search term and sorts by 24h gainers and boosted', () => {
  const bonkResults = filterAndSortTokens(SAMPLE_LIVE_TOKENS, {
    search: 'bonk',
    tab: 'all',
    sortBy: 'change24h',
  });
  assert.equal(bonkResults.length, 1);
  assert.equal(bonkResults[0].symbol, 'BONK');

  const gainers = filterAndSortTokens(SAMPLE_LIVE_TOKENS, {
    search: '',
    tab: 'gainers',
    sortBy: 'change24h',
  });
  assert.equal(gainers.length, 2);
  assert.ok(gainers.every((t) => t.change24h > 0));
  assert.equal(gainers[0].symbol, 'BONK');

  const boosted = filterAndSortTokens(SAMPLE_LIVE_TOKENS, {
    search: '',
    tab: 'boosted',
    sortBy: 'boostMultiplier',
  });
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].symbol, 'BONK');
});

test('computeSwapQuote calculates output, slippage, and rejects insufficient balance', () => {
  const quote = computeSwapQuote({
    fromChain: 'solana',
    toChain: 'solana',
    fromSymbol: 'SOL',
    toSymbol: 'USDC',
    fromPriceUsd: 200,
    toPriceUsd: 1,
    amount: 2.5,
    slippagePct: 0.5,
    mevProtected: true,
    availableBalance: 10,
  });

  assert.equal(quote.valid, true);
  assert.ok(quote.estimatedOutput > 495 && quote.estimatedOutput < 500);
  assert.ok(quote.minimumReceived < quote.estimatedOutput);
  assert.match(quote.routeProvider, /Jupiter/);

  const overBalance = computeSwapQuote({
    fromChain: 'solana',
    toChain: 'solana',
    fromSymbol: 'SOL',
    toSymbol: 'USDC',
    fromPriceUsd: 200,
    toPriceUsd: 1,
    amount: 50,
    slippagePct: 0.5,
    mevProtected: true,
    availableBalance: 10,
  });
  assert.equal(overBalance.valid, false);
  assert.match(overBalance.error ?? '', /Insufficient/);
});

test('validateLaunchForm enforces SPL u64 supply bounds, required fields, and real ~0.0036 SOL network rent with 0 markup', () => {
  const invalid = validateLaunchForm({
    name: 'A',
    symbol: '',
    category: 'AI',
    description: 'short',
    decimals: 12,
    totalSupply: 10,
    initialLpSol: -5,
    modifyCreator: true,
    creatorName: '',
    mintRevoked: false,
    freezeRevoked: false,
    lpLockedMonths: 0,
    metadataImmutable: false,
    boostTier: 'none',
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.name);
  assert.ok(invalid.errors.symbol);
  assert.ok(invalid.errors.decimals);
  assert.ok(invalid.errors.creatorName);

  const valid = validateLaunchForm({
    name: 'GOKU',
    symbol: 'goku',
    category: 'Meme',
    description: 'GOKU COIN community meme token deployed on Solana.',
    decimals: 9,
    totalSupply: 1000000000,
    initialLpSol: 0,
    modifyCreator: false,
    mintRevoked: true,
    freezeRevoked: true,
    lpLockedMonths: 12,
    metadataImmutable: true,
    boostTier: 'none',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalizedSymbol, 'GOKU');
  assert.equal(valid.securityScore, 100);
  assert.equal(valid.authorityFeesSol, 0);
  assert.equal(valid.creatorFeeSol, 0);
  assert.equal(valid.estimatedRentSol, BASE_DEPLOY_FEE_SOL);
  assert.equal(valid.totalDeployCostSol, BASE_DEPLOY_FEE_SOL);
});

test('computeLiquidityPoolQuote validates deposits and computes Raydium/Meteora LP tokens and TVL', () => {
  const quote = computeLiquidityPoolQuote({
    dex: 'Raydium',
    baseAmount: 500000000,
    quoteAmount: 20,
    quoteSymbol: 'SOL',
    solPriceUsd: 210,
    feeTierPct: 0.25,
    availableQuoteBalance: 80,
  });
  assert.equal(quote.valid, true);
  assert.equal(quote.tvlUsd, 8400);
  assert.equal(quote.poolCreationFeeSol, 0.2);
  assert.ok(quote.lpTokensMinted > 0);

  const badQuote = computeLiquidityPoolQuote({
    dex: 'Meteora',
    baseAmount: 1000,
    quoteAmount: 120,
    quoteSymbol: 'SOL',
    solPriceUsd: 210,
    feeTierPct: 0.2,
    availableQuoteBalance: 10,
  });
  assert.equal(badQuote.valid, false);
  assert.match(badQuote.error ?? '', /Insufficient/);
});

test('evaluateAlertRules triggers matching alerts once without duplicating open alerts', () => {
  const rules = [
    {
      id: 'r1',
      tokenSymbol: 'SOL',
      metric: 'price_above' as const,
      threshold: 150,
      active: true,
      createdAt: new Date().toISOString(),
      triggeredCount: 0,
    },
    {
      id: 'r2',
      tokenSymbol: 'SOL',
      metric: 'price_below' as const,
      threshold: 50,
      active: true,
      createdAt: new Date().toISOString(),
      triggeredCount: 0,
    },
  ];

  const firstRun = evaluateAlertRules(rules, SAMPLE_LIVE_TOKENS, []);
  assert.equal(firstRun.newlyTriggered.length, 1);
  assert.equal(firstRun.newlyTriggered[0].tokenSymbol, 'SOL');
  assert.equal(firstRun.updatedRules[0].triggeredCount, 1);

  const secondRun = evaluateAlertRules(
    firstRun.updatedRules,
    SAMPLE_LIVE_TOKENS,
    firstRun.newlyTriggered
  );
  assert.equal(secondRun.newlyTriggered.length, 0);
});

test('validateAlertInput and formatters behave predictably', () => {
  assert.equal(validateAlertInput('SOL', 'price_above', 0).valid, false);
  assert.equal(validateAlertInput('SOL', 'price_above', 250).valid, true);
  assert.equal(formatUsd(214.65), '$214.65');
  assert.equal(formatUsd(0.0000384), '$0.00003840');
  assert.equal(formatCompactUsd(1574000000), '$1.57B');
});

test('selectLegitimateDexPair rejects spoofed wash-traded pools and picks highest-volume genuine pair', () => {
  const addr = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
  const selected = selectLegitimateDexPair(
    [
      {
        chainId: 'solana',
        baseToken: { address: addr },
        quoteToken: { symbol: 'SCAM' },
        priceUsd: '6657.82',
        priceChange: { h24: 507769 },
        volume: { h24: 8000000 },
        liquidity: { usd: 76000000 },
      },
      {
        chainId: 'solana',
        baseToken: { address: addr },
        quoteToken: { symbol: 'USDC' },
        priceUsd: '5.51',
        priceChange: { h24: 12.4 },
        volume: { h24: 18500000 },
        liquidity: { usd: 14200000 },
      },
    ],
    addr,
    5.42
  );

  assert.ok(selected);
  assert.equal(selected.priceUsd, '5.51');
  assert.equal(selected.quoteToken?.symbol, 'USDC');
});

test('explorer & DEX URL builders generate operational Solscan, DexScreener (pair-aware), Raydium, and Meteora links', () => {
  const bonkMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const bonkPair = '8QaXeHBrShJTdtN1rWHbp3pDTtD64c56F7sP4K8dJ9zQ';
  const links = getTokenExternalLinks(bonkMint, 'Mainnet-Beta', bonkPair);

  assert.equal(links.solscan, `https://solscan.io/token/${bonkMint}`);
  assert.equal(links.dexscreener, `https://dexscreener.com/solana/${bonkPair}`);
  assert.equal(
    links.raydiumSwap,
    `https://raydium.io/swap/?inputMint=sol&outputMint=${bonkMint}`
  );
  assert.equal(
    links.raydiumPools,
    `https://raydium.io/liquidity-pools/?token=${bonkMint}`
  );
  assert.equal(
    links.meteoraPools,
    `https://app.meteora.ag/dlmm?search=${bonkMint}`
  );
  assert.equal(getRaydiumCreatePoolUrl(), 'https://raydium.io/liquidity/create-pool/');
  assert.equal(getMeteoraCreatePoolUrl(), 'https://app.meteora.ag/pools/create');

  // Devnet cluster query support
  assert.equal(
    getSolscanTokenUrl(bonkMint, 'Devnet'),
    `https://solscan.io/token/${bonkMint}?cluster=devnet`
  );
  assert.equal(
    getSolscanAccountUrl(bonkMint, 'Devnet'),
    `https://solscan.io/account/${bonkMint}?cluster=devnet`
  );
  assert.equal(
    getSolscanTxUrl('5YbzExampleHash123456', 'Devnet'),
    'https://solscan.io/tx/5YbzExampleHash123456?cluster=devnet'
  );

  assert.equal(
    getRaydiumSwapUrl(SOL_MINT_ADDRESS),
    `https://raydium.io/swap/?inputMint=sol&outputMint=${USDC_MINT_ADDRESS}`
  );
  assert.equal(
    getDexScreenerTokenUrl('BONK'),
    'https://dexscreener.com/solana?q=BONK'
  );
  assert.equal(
    resolveTokenAddressBySymbol('$BONK', SAMPLE_LIVE_TOKENS),
    bonkMint
  );
  assert.equal(
    resolveTokenAddressBySymbol('BONK-LP', SAMPLE_LIVE_TOKENS),
    bonkMint
  );
});

test('solanaRpc BigInt conversions, public key validation, and URL sanitization work accurately', () => {
  assert.equal(isValidSolanaPublicKey(SOL_MINT_ADDRESS), true);
  assert.equal(isValidSolanaPublicKey('not-a-valid-key!'), false);

  assert.equal(lamportsToSol(1_500_000_000), 1.5);
  assert.equal(solToLamports(0.25), 250_000_000);
  assert.equal(toRawTokenAmount('1000000000', 9), 1_000_000_000_000_000_000n);
  assert.equal(toRawTokenAmount('1.25', 6), 1_250_000n);
  assert.equal(fromRawTokenAmount('1250000', 6), 1.25);

  assert.equal(sanitizeExternalUrl('https://dexscreener.com/solana/abc'), 'https://dexscreener.com/solana/abc');
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), undefined);
});

test('solanaRpc parsers map RPC mint info, DexScreener pairs, wallet token accounts, and Jupiter quotes cleanly', () => {
  const parsedMint = parseMintAccountJsonParsed({
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    data: {
      parsed: {
        type: 'mint',
        info: {
          decimals: 6,
          supply: '1000000000000',
          mintAuthority: null,
          freezeAuthority: null,
        },
      },
    },
  });
  assert.equal(parsedMint.exists, true);
  assert.equal(parsedMint.decimals, 6);
  assert.equal(parsedMint.supplyUi, 1_000_000);
  assert.equal(parsedMint.mintRevoked, true);
  assert.equal(parsedMint.freezeRevoked, true);

  const pair = {
    chainId: 'solana',
    dexId: 'raydium',
    pairAddress: '8QaXeHBrShJTdtN1rWHbp3pDTtD64c56F7sP4K8dJ9zQ',
    url: 'https://dexscreener.com/solana/8QaXeHBrShJTdtN1rWHbp3pDTtD64c56F7sP4K8dJ9zQ',
    baseToken: {
      address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      name: 'Bonk',
      symbol: 'BONK',
    },
    quoteToken: {
      address: SOL_MINT_ADDRESS,
      symbol: 'SOL',
    },
    priceUsd: '0.0000315',
    priceChange: { m5: 0.8, h1: 2.1, h6: 5.0, h24: 11.4 },
    volume: { h24: 42_000_000 },
    liquidity: { usd: 15_000_000 },
    marketCap: 2_100_000_000,
    txns: { h24: { buys: 1200, sells: 900 } },
  };

  const best = selectBestSolanaPair([pair], pair.baseToken.address);
  assert.ok(best);
  const mappedTok = mapDexPairToSolanaToken(best, parsedMint);
  assert.ok(mappedTok);
  assert.equal(mappedTok.symbol, 'BONK');
  assert.equal(mappedTok.pairAddress, pair.pairAddress);
  assert.equal(mappedTok.onChainVerified, true);

  const pools = mapDexPairsToPools([pair]);
  assert.equal(pools.length, 1);
  assert.equal(pools[0].dexLabel, 'Raydium');

  const accounts = parseRpcTokenAccounts(
    [
      {
        pubkey: 'ATA1111111111111111111111111111111111111111',
        account: {
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          data: {
            parsed: {
              info: {
                mint: USDC_MINT_ADDRESS,
                tokenAmount: { amount: '50000000', decimals: 6, uiAmount: 50 },
              },
            },
          },
        },
      },
      {
        pubkey: 'ATA2222222222222222222222222222222222222222',
        account: {
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          data: {
            parsed: {
              info: {
                mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
                tokenAmount: { amount: '0', decimals: 5, uiAmount: 0 },
              },
            },
          },
        },
      },
    ],
    new Map()
  );
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].symbol, 'USDC');
  assert.equal(accounts[0].valueUsd, 50);
  assert.equal(accounts[1].isEmpty, true);

  const jupQuote = parseJupiterQuoteResponse({
    inputMint: SOL_MINT_ADDRESS,
    outputMint: USDC_MINT_ADDRESS,
    inAmount: '100000000',
    outAmount: '18500000',
    otherAmountThreshold: '18407500',
    priceImpactPct: '0.0012',
    slippageBps: 50,
    routePlan: [{ swapInfo: { label: 'Raydium CLMM' } }, { swapInfo: { label: 'Whirlpool' } }],
  });
  assert.ok(jupQuote);
  assert.equal(jupQuote.outAmount, '18500000');
  assert.deepEqual(jupQuote.routeLabels, ['Raydium CLMM', 'Whirlpool']);
});
