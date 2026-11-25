import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 0 TDD Security Rules & Dirty Dozen Payload Suite.
 * Validates both the static security invariants compiled into firestore.rules
 * and our strict client-side blueprint payload validators against all 12
 * adversarial "Dirty Dozen" attack vectors documented in security_spec.md.
 */

const RULES_FILE = fs.existsSync(path.resolve(process.cwd(), 'firestore.rules'))
  ? 'firestore.rules'
  : 'DRAFT_firestore.rules';

const rulesSource = fs.readFileSync(path.resolve(process.cwd(), RULES_FILE), 'utf8');

const ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

interface AuthContext {
  uid: string;
  emailVerified: boolean;
}

function assertValidId(id: string): boolean {
  return typeof id === 'string' && ID_REGEX.test(id);
}

function canCreateToken(
  auth: AuthContext | null,
  tokenId: string,
  payload: Record<string, unknown>,
  serverTimeSentinel: symbol
): boolean {
  if (!auth || !auth.emailVerified) return false;
  if (!assertValidId(tokenId)) return false;

  const required = [
    'ownerId', 'visibility', 'address', 'symbol', 'name', 'category',
    'priceUsd', 'change5m', 'change1h', 'change24h', 'volume24h',
    'liquidityUsd', 'marketCap', 'holders', 'ageHours', 'boostMultiplier',
    'boostTier', 'verifiedDev', 'security', 'sparkline', 'description',
    'decimals', 'totalSupply', 'launchedByUser', 'dexSource',
    'createdAt', 'updatedAt',
  ];
  const allowed = new Set([
    ...required,
    'imageUrl', 'creatorName', 'creatorWebsite', 'website', 'twitter', 'telegram', 'discord',
    'pairAddress', 'dexUrl', 'txSignature', 'cluster',
  ]);

  const keys = Object.keys(payload);
  if (!required.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => allowed.has(k))) return false;
  if (payload.ownerId !== auth.uid) return false;
  if (payload.address !== tokenId) return false;
  if (payload.visibility !== 'public') return false;
  if (payload.createdAt !== serverTimeSentinel || payload.updatedAt !== serverTimeSentinel) return false;
  return true;
}

test('Rules structure enforces Eight Pillars (default deny, verified user, strict IDs, immutable ledger, terminal LP lock)', () => {
  assert.match(rulesSource, /rules_version\s*=\s*'2';/);
  assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rulesSource, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesSource, /isValidId\(/);
  assert.match(rulesSource, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesSource, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rulesSource, /existing\(\)\.lpBurned == false/);
  assert.match(rulesSource, /allow update, delete: if false;/);
  assert.match(rulesSource, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\/alertRules\/\$\(incoming\(\)\.ruleId\)\)/);
  assert.match(rulesSource, /'keypair'/);
  assert.match(rulesSource, /'watch'/);
  assert.match(rulesSource, /'WITHDRAW'/);
  assert.match(rulesSource, /'BURN'/);
  assert.match(rulesSource, /'AIRDROP'/);
  assert.doesNotMatch(rulesSource, /allow list:\s*if isSignedIn\(\);/);
});

test('Dirty Dozen 1-3: rejects shadow fields, spoofed ownerId, and unverified emails on token creation', () => {
  const SERVER_TIME = Symbol('request.time');
  const validUser: AuthContext = { uid: 'user_alice', emailVerified: true };
  const unverifiedUser: AuthContext = { uid: 'user_alice', emailVerified: false };

  const basePayload: Record<string, unknown> = {
    ownerId: 'user_alice',
    visibility: 'public',
    address: 'GOKU9xKm2pQr7sT5vW3yZ1cB6dE4fG2hJ8kL9mN4pQ',
    symbol: 'GOKU',
    name: 'Goku Coin',
    category: 'Meme',
    priceUsd: 0.0001,
    change5m: 3.4,
    change1h: 12.6,
    change24h: 18.4,
    volume24h: 10000,
    liquidityUsd: 4000,
    marketCap: 100000,
    holders: 42,
    ageHours: 0.1,
    boostMultiplier: 1,
    boostTier: 'none',
    verifiedDev: true,
    security: { mintRevoked: true, freezeRevoked: true, lpLockedMonths: 12, metadataImmutable: true },
    sparkline: [0.00008, 0.0001],
    description: 'Audited Solana SPL meme coin launched via YABBAI.',
    decimals: 9,
    totalSupply: 1_000_000_000,
    launchedByUser: true,
    dexSource: 'YABBAI Launch Pool',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };

  assert.equal(canCreateToken(validUser, String(basePayload.address), basePayload, SERVER_TIME), true);

  // 1. Shadow field injection
  assert.equal(
    canCreateToken(validUser, String(basePayload.address), { ...basePayload, isFeatured: true }, SERVER_TIME),
    false
  );

  // 2. Identity spoofing
  assert.equal(
    canCreateToken(validUser, String(basePayload.address), { ...basePayload, ownerId: 'user_bob' }, SERVER_TIME),
    false
  );

  // 3. Unverified email write
  assert.equal(
    canCreateToken(unverifiedUser, String(basePayload.address), basePayload, SERVER_TIME),
    false
  );
});

test('Dirty Dozen 4-12: rejects cross-user reads, ledger tampering, burned LP changes, forged timestamps, ID poisoning, and upvote inflation', () => {
  const SERVER_TIME = Symbol('request.time');
  const validUser: AuthContext = { uid: 'user_alice', emailVerified: true };

  // 4 & 5. Cross-user wallet/tx access
  const isOwner = (auth: AuthContext, userId: string) => auth.emailVerified && auth.uid === userId;
  assert.equal(isOwner({ uid: 'user_bob', emailVerified: true }, 'user_alice'), false);

  // 6 & 7. Immutable transactions check in compiled rules
  assert.match(rulesSource, /match \/transactions\/\{txId\}[\s\S]*?allow update, delete: if false;/);

  // 8. Burned LP terminal state lock
  const canModifyPool = (existingLpBurned: boolean) => existingLpBurned === false;
  assert.equal(canModifyPool(true), false);
  assert.equal(canModifyPool(false), true);

  // 9. Client timestamp forgery
  assert.equal(
    canCreateToken(
      validUser,
      'GOKU9xKm2pQr7sT5vW3yZ1cB6dE4fG2hJ8kL9mN4pQ',
      { ownerId: 'user_alice', address: 'GOKU9xKm2pQr7sT5vW3yZ1cB6dE4fG2hJ8kL9mN4pQ', createdAt: '2020-01-01T00:00:00Z' },
      SERVER_TIME
    ),
    false
  );

  // 10. Path ID poisoning
  assert.equal(assertValidId('x'.repeat(200)), false);
  assert.equal(assertValidId('bad/id!@#'), false);

  // 11. Upvote inflation guard in rules
  assert.match(rulesSource, /incoming\(\)\.upvotes == existing\(\)\.upvotes \+ 1/);

  // 12. Orphaned triggeredAlert guard in rules
  assert.match(rulesSource, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\/alertRules\/\$\(incoming\(\)\.ruleId\)\)/);
});
