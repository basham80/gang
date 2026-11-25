import { Buffer } from 'buffer';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { SolanaCluster, WalletProviderId } from '../types/solana';
import { lamportsToSol, solToLamports, toRawTokenAmount } from '../utils/solanaRpc';

// Compatibility shim: @solana/spl-token expects PublicKey.prototype.toBuffer (removed in @solana/web3.js v3)
if (
  typeof PublicKey !== 'undefined' &&
  typeof (PublicKey.prototype as unknown as { toBuffer?: () => Buffer }).toBuffer !== 'function'
) {
  Object.defineProperty(PublicKey.prototype, 'toBuffer', {
    value(this: PublicKey) {
      return Buffer.from(this.toBytes());
    },
    configurable: true,
  });
}

const LOCAL_KEYPAIR_STORAGE_KEY = 'yabbai_solana_ed25519_keypair_v1';

export interface InjectedSolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isConnected?: boolean;
  publicKey?: { toString: () => string; toBase58?: () => string };
  connect: (opts?: {
    onlyIfTrusted?: boolean;
  }) => Promise<{ publicKey?: { toString: () => string; toBase58?: () => string } } | boolean>;
  disconnect?: () => Promise<void>;
  signTransaction?: <T extends VersionedTransaction>(tx: T) => Promise<T | Uint8Array>;
  signAllTransactions?: <T extends VersionedTransaction>(txs: T[]) => Promise<T[]>;
  signAndSendTransaction?: (
    tx: VersionedTransaction,
    options?: {
      preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
      skipPreflight?: boolean;
      maxRetries?: number;
    }
  ) => Promise<{ signature: string } | string>;
  signMessage?: (
    message: Uint8Array,
    display?: 'utf8' | 'hex'
  ) => Promise<{ signature: Uint8Array; publicKey?: { toString: () => string } } | Uint8Array>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    phantom?: {
      solana?: InjectedSolanaProvider;
    };
    solana?: InjectedSolanaProvider;
    solflare?: InjectedSolanaProvider;
    backpack?: InjectedSolanaProvider & { solana?: InjectedSolanaProvider };
    ethereum?: {
      request: (args: { method: string }) => Promise<string[]>;
    };
  }
}

export function getSolanaConnection(network: SolanaCluster): Connection {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:3000';
  const endpoint = `${origin}/api/solana/rpc?network=${encodeURIComponent(network)}`;
  return new Connection(endpoint, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60_000,
  });
}

// ---------- Official Phantom / Solflare / Backpack Extension Detection ----------

export function getInjectedSolanaProvider(
  providerId: WalletProviderId | null
): InjectedSolanaProvider | null {
  if (typeof window === 'undefined' || !providerId) return null;

  if (providerId === 'phantom') {
    // Official Phantom priority: window.phantom.solana first (immune to window.solana overrides)
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    return null;
  }

  if (providerId === 'solflare') {
    if (window.solflare) return window.solflare;
    if (window.solana?.isSolflare) return window.solana;
    return null;
  }

  if (providerId === 'backpack') {
    return window.backpack?.solana ?? window.backpack ?? null;
  }

  return null;
}

export function detectInjectedWallets(): {
  phantom: boolean;
  solflare: boolean;
  backpack: boolean;
  inIframe: boolean;
} {
  if (typeof window === 'undefined') {
    return { phantom: false, solflare: false, backpack: false, inIframe: false };
  }
  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }
  return {
    phantom: Boolean(getInjectedSolanaProvider('phantom')),
    solflare: Boolean(getInjectedSolanaProvider('solflare')),
    backpack: Boolean(getInjectedSolanaProvider('backpack')),
    inIframe,
  };
}

// ---------- Client-Side Non-Custodial Ed25519 Keypair Manager (@solana/web3.js v3 WebCrypto async) ----------

export function hasStoredLocalKeypair(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEYPAIR_STORAGE_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) && arr.length === 64;
  } catch {
    return false;
  }
}

export async function getStoredLocalKeypair(): Promise<Keypair | null> {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEYPAIR_STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== 64) return null;
    return await Keypair.fromSecretKey(Uint8Array.from(arr.map(Number)));
  } catch {
    return null;
  }
}

export async function createLocalSolanaKeypair(): Promise<{ publicKey: string }> {
  const kp = await Keypair.generate();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      LOCAL_KEYPAIR_STORAGE_KEY,
      JSON.stringify(Array.from(kp.secretKey))
    );
  }
  return { publicKey: kp.publicKey.toBase58() };
}

export async function importLocalSolanaKeypair(
  secretInput: string
): Promise<{ publicKey: string }> {
  const trimmed = secretInput.trim();
  if (!trimmed) {
    throw new Error('Paste a 64-byte Solana CLI JSON keypair array (e.g. [12,34,...]).');
  }

  let secretBytes: Uint8Array;
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error('JSON secret key must contain exactly 64 numbers (0–255).');
    }
    secretBytes = Uint8Array.from(parsed.map((n) => Number(n)));
  } else if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    secretBytes = Uint8Array.from(Buffer.from(trimmed, 'hex'));
  } else {
    throw new Error(
      'Unsupported key format. Paste a 64-byte JSON array from Solana CLI / Phantom export or a 128-char hex secret key.'
    );
  }

  const kp = await Keypair.fromSecretKey(secretBytes);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      LOCAL_KEYPAIR_STORAGE_KEY,
      JSON.stringify(Array.from(kp.secretKey))
    );
  }
  return { publicKey: kp.publicKey.toBase58() };
}

export async function exportLocalKeypairJson(): Promise<string | null> {
  const kp = await getStoredLocalKeypair();
  if (!kp) return null;
  return JSON.stringify(Array.from(kp.secretKey));
}

export function clearLocalSolanaKeypair(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LOCAL_KEYPAIR_STORAGE_KEY);
  }
}

// ---------- Extension Signing Helpers (100% Phantom Mainnet Compatible via VersionedTransaction) ----------

function normalizeProviderError(err: unknown, providerLabel: string): Error {
  if (err && typeof err === 'object') {
    const e = err as { code?: number; message?: string };
    const msg = e.message ?? '';
    if (e.code === 4001 || /user rejected|rejected the request|declined/i.test(msg)) {
      return new Error(`Transaction signature was rejected in ${providerLabel}.`);
    }
    if (msg) return new Error(msg);
  }
  return new Error(
    err instanceof Error ? err.message : `${providerLabel} transaction signing failed.`
  );
}

function getProviderDisplayName(providerId: WalletProviderId | null): string {
  if (providerId === 'phantom') return 'Phantom';
  if (providerId === 'solflare') return 'Solflare';
  if (providerId === 'backpack') return 'Backpack';
  return 'Wallet Extension';
}

async function ensureExtensionReadyForSigner(
  providerId: WalletProviderId | null,
  expectedSigner: string
): Promise<InjectedSolanaProvider> {
  const label = getProviderDisplayName(providerId);
  const injected = getInjectedSolanaProvider(providerId);
  if (!injected) {
    throw new Error(
      `${label} browser extension was not detected. Open YABBAI in your browser tab with ${label} unlocked, or connect a Local Keypair.`
    );
  }

  // Re-establish extension session if page reloaded after session restore
  if (!injected.isConnected || !injected.publicKey) {
    try {
      await injected.connect();
    } catch (err) {
      throw normalizeProviderError(err, label);
    }
  }

  const activePubkey = injected.publicKey?.toString() ?? '';
  if (!activePubkey) {
    throw new Error(`Could not read active Solana account from ${label}.`);
  }
  if (activePubkey !== expectedSigner) {
    throw new Error(
      `Active account in ${label} (${activePubkey.slice(0, 4)}...${activePubkey.slice(-4)}) does not match connected wallet (${expectedSigner.slice(0, 4)}...${expectedSigner.slice(-4)}). Switch accounts in ${label} or reconnect.`
    );
  }

  return injected;
}

function extractSignedBytes(signed: VersionedTransaction | Uint8Array): Uint8Array {
  if (signed instanceof Uint8Array) return signed;
  if (typeof (signed as { serialize?: () => Uint8Array }).serialize === 'function') {
    return Uint8Array.from((signed as { serialize: () => Uint8Array }).serialize());
  }
  throw new Error('Wallet extension returned an unreadable signed transaction object.');
}

function assertFeePayerSigned(rawBytes: Uint8Array, providerLabel: string): void {
  const parsed = VersionedTransaction.deserialize(rawBytes);
  const firstSig = parsed.signatures[0];
  if (!firstSig || firstSig.length !== 64 || firstSig.every((b) => b === 0)) {
    throw new Error(
      `${providerLabel} did not attach a valid Ed25519 signature to this transaction.`
    );
  }
}

/**
 * Confirms a transaction signature purely over HTTP JSON-RPC (`getSignatureStatuses`),
 * avoiding browser WebSocket errors against HTTP-only RPC proxy routes.
 */
async function confirmSignatureViaRpc(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number | bigint,
  timeoutMs = 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const maxHeight = Number(lastValidBlockHeight);

  while (Date.now() < deadline) {
    try {
      const statusResp = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = statusResp.value[0];
      if (status) {
        if (status.err) {
          throw new Error(
            `Solana transaction failed on-chain: ${JSON.stringify(status.err)}`
          );
        }
        if (
          status.confirmationStatus === 'confirmed' ||
          status.confirmationStatus === 'finalized'
        ) {
          return;
        }
      }

      if (maxHeight > 0) {
        const currentHeight = Number(await connection.getBlockHeight('confirmed'));
        if (currentHeight > maxHeight + 10) {
          throw new Error(
            `Transaction ${signature.slice(0, 12)}... expired before confirmation on Solana. Try again with fresh blockhash.`
          );
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('failed on-chain') || err.message.includes('expired'))
      ) {
        throw err;
      }
      // Ignore transient RPC poll errors and retry until deadline
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error(
    `Timed out waiting for Solana confirmation for ${signature.slice(0, 12)}.... Check Solscan to verify status.`
  );
}

/**
 * Builds a wire-compatible v0 VersionedTransaction (sync .serialize() — 100% compatible with
 * Phantom, Solflare, and Backpack extensions on Mainnet-Beta and Devnet), prompts the real
 * wallet extension to sign, and confirms on-chain over HTTP JSON-RPC.
 */
async function signAndSendInstructions(
  connection: Connection,
  network: SolanaCluster,
  instructions: TransactionInstruction[],
  providerId: WalletProviderId | null,
  feePayer: PublicKey,
  extraSigners: Keypair[] = []
): Promise<string> {
  const latest = await connection.getLatestBlockhash('confirmed');

  // Add a modest Mainnet priority fee so Phantom-signed transactions land reliably during congestion
  const finalInstructions =
    network === 'Mainnet-Beta'
      ? [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 }),
          ...instructions,
        ]
      : instructions;

  const messageV0 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: latest.blockhash,
    instructions: finalInstructions,
  }).compileToV0Message();

  const vtx = new VersionedTransaction(messageV0);
  let signature: string;

  if (providerId === 'keypair') {
    const kp = await getStoredLocalKeypair();
    if (!kp || kp.publicKey.toBase58() !== feePayer.toBase58()) {
      throw new Error('Local Solana keypair does not match connected address.');
    }
    await vtx.sign([kp, ...extraSigners]);
    signature = await connection.sendRawTransaction(vtx.serialize(), {
      skipPreflight: false,
      maxRetries: 3n,
    });
  } else {
    const label = getProviderDisplayName(providerId);
    const injected = await ensureExtensionReadyForSigner(
      providerId,
      feePayer.toBase58()
    );

    try {
      // Single-signer Mainnet/Devnet flow: official Phantom recommendation is signAndSendTransaction
      // (opens Phantom's real approval popup AND submits through Phantom's dedicated Mainnet RPC).
      if (extraSigners.length === 0 && injected.signAndSendTransaction) {
        const result = await injected.signAndSendTransaction(vtx, {
          preflightCommitment: 'confirmed',
          skipPreflight: false,
          maxRetries: 3,
        });
        signature = typeof result === 'string' ? result : result.signature;
      } else if (injected.signTransaction) {
        // Multi-signer flow (e.g. SPL Mint launch) or extension without signAndSendTransaction:
        // Prompt Phantom to sign FIRST (zero Blowfish pre-sign warning), then add local mintKeypair signature.
        const signedByExtension = await injected.signTransaction(vtx);
        let rawBytes = extractSignedBytes(signedByExtension);
        assertFeePayerSigned(rawBytes, label);

        if (extraSigners.length > 0) {
          const rehydrated = VersionedTransaction.deserialize(rawBytes);
          await rehydrated.sign(extraSigners);
          rawBytes = rehydrated.serialize();
        }

        signature = await connection.sendRawTransaction(rawBytes, {
          skipPreflight: false,
          maxRetries: 3n,
        });
      } else if (injected.signAndSendTransaction) {
        // Fallback when provider only exposes signAndSendTransaction and extraSigners exist
        if (extraSigners.length > 0) {
          await vtx.sign(extraSigners);
        }
        const result = await injected.signAndSendTransaction(vtx, {
          preflightCommitment: 'confirmed',
          skipPreflight: false,
          maxRetries: 3,
        });
        signature = typeof result === 'string' ? result : result.signature;
      } else {
        throw new Error(`${label} extension does not expose Solana signing methods.`);
      }
    } catch (err) {
      throw normalizeProviderError(err, label);
    }
  }

  await confirmSignatureViaRpc(connection, signature, latest.lastValidBlockHeight);
  return signature;
}

async function signAndSendPrebuiltVersionedTx(
  connection: Connection,
  tx: VersionedTransaction,
  providerId: WalletProviderId | null,
  expectedSigner: string
): Promise<string> {
  const latest = await connection.getLatestBlockhash('confirmed');
  let signature: string;

  if (providerId === 'keypair') {
    const kp = await getStoredLocalKeypair();
    if (!kp || kp.publicKey.toBase58() !== expectedSigner) {
      throw new Error('Local Solana keypair does not match connected address.');
    }
    await tx.sign([kp]);
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3n,
    });
  } else {
    const label = getProviderDisplayName(providerId);
    const injected = await ensureExtensionReadyForSigner(providerId, expectedSigner);

    try {
      if (injected.signAndSendTransaction) {
        const res = await injected.signAndSendTransaction(tx, {
          preflightCommitment: 'confirmed',
          skipPreflight: false,
          maxRetries: 3,
        });
        signature = typeof res === 'string' ? res : res.signature;
      } else if (injected.signTransaction) {
        const signed = await injected.signTransaction(tx);
        const rawBytes = extractSignedBytes(signed);
        assertFeePayerSigned(rawBytes, label);
        signature = await connection.sendRawTransaction(rawBytes, {
          skipPreflight: false,
          maxRetries: 3n,
        });
      } else {
        throw new Error(`${label} does not support VersionedTransaction signing.`);
      }
    } catch (err) {
      throw normalizeProviderError(err, label);
    }
  }

  await confirmSignatureViaRpc(connection, signature, latest.lastValidBlockHeight);
  return signature;
}

/**
 * Triggers a 0-SOL off-chain Ed25519 signature prompt directly inside the Phantom / Solflare / Backpack
 * browser extension so users can verify real extension signing works before executing Mainnet txs.
 */
export async function verifyExtensionMessageSignature(
  providerId: WalletProviderId | null,
  expectedSigner: string,
  network: SolanaCluster
): Promise<{ signatureHex: string; signer: string }> {
  const label = getProviderDisplayName(providerId);
  const injected = await ensureExtensionReadyForSigner(providerId, expectedSigner);
  if (!injected.signMessage) {
    throw new Error(`${label} extension does not expose signMessage.`);
  }

  const challenge = `YABBAI Solana ${network} Signer Verification\nWallet: ${expectedSigner}\nTimestamp: ${new Date().toISOString()}`;
  const encoded = new TextEncoder().encode(challenge);

  try {
    const res = await injected.signMessage(encoded, 'utf8');
    const sigBytes = res instanceof Uint8Array ? res : res.signature;
    if (!sigBytes || sigBytes.length !== 64) {
      throw new Error(`${label} returned an invalid signature length.`);
    }
    return {
      signatureHex: Buffer.from(sigBytes).toString('hex'),
      signer: expectedSigner,
    };
  } catch (err) {
    throw normalizeProviderError(err, label);
  }
}

// ---------- 1. REAL ON-CHAIN SPL TOKEN LAUNCH ----------

export interface OnChainLaunchParams {
  network: SolanaCluster;
  provider: WalletProviderId | null;
  payerAddress: string;
  decimals: number;
  totalSupply: number;
  mintRevoked: boolean;
  freezeRevoked: boolean;
}

export interface OnChainLaunchResult {
  mintAddress: string;
  ataAddress: string;
  signature: string;
  costSol: number;
  cluster: SolanaCluster;
}

export async function launchRealSplTokenOnChain(
  params: OnChainLaunchParams
): Promise<OnChainLaunchResult> {
  const connection = getSolanaConnection(params.network);
  const payer = new PublicKey(params.payerAddress);

  const mintRent = Number(await getMinimumBalanceForRentExemptMint(connection));
  const estimatedAtaRent = 2_039_280;
  const minRequiredLamports = mintRent + estimatedAtaRent + 100_000;

  const currentLamports = Number(await connection.getBalance(payer, 'confirmed'));
  if (currentLamports < minRequiredLamports) {
    const needSol = lamportsToSol(minRequiredLamports).toFixed(4);
    const haveSol = lamportsToSol(currentLamports).toFixed(4);
    throw new Error(
      params.network === 'Devnet'
        ? `Insufficient Devnet SOL (${haveSol} SOL available, ~${needSol} SOL required for SPL Mint + ATA rent). Open Wallet and click "Request 1 Real Devnet SOL" first.`
        : `Insufficient Mainnet SOL (${haveSol} SOL available, ~${needSol} SOL required for real SPL Mint + ATA rent). Fund ${params.payerAddress} with Mainnet SOL in Phantom.`
    );
  }

  const mintKeypair = await Keypair.generate();
  const ata = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    payer,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const rawSupply = toRawTokenAmount(params.totalSupply, params.decimals);
  if (rawSupply <= 0n || rawSupply > 18_446_744_073_709_551_615n) {
    throw new Error('Total supply exceeds SPL u64 maximum for the selected decimals.');
  }

  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      params.decimals,
      payer,
      params.freezeRevoked ? null : payer,
      TOKEN_PROGRAM_ID
    ),
    createAssociatedTokenAccountInstruction(
      payer,
      ata,
      payer,
      mintKeypair.publicKey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      ata,
      payer,
      rawSupply,
      [],
      TOKEN_PROGRAM_ID
    ),
  ];

  if (params.mintRevoked) {
    instructions.push(
      createSetAuthorityInstruction(
        mintKeypair.publicKey,
        payer,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  const signature = await signAndSendInstructions(
    connection,
    params.network,
    instructions,
    params.provider,
    payer,
    [mintKeypair]
  );

  return {
    mintAddress: mintKeypair.publicKey.toBase58(),
    ataAddress: ata.toBase58(),
    signature,
    costSol: Number(
      ((mintRent + estimatedAtaRent + 15_000) / LAMPORTS_PER_SOL).toFixed(5)
    ),
    cluster: params.network,
  };
}

// ---------- 2. REAL ON-CHAIN WITHDRAWALS (SOL & SPL TOKENS) ----------

export async function withdrawSolOnChain(params: {
  network: SolanaCluster;
  provider: WalletProviderId | null;
  fromAddress: string;
  recipientAddress: string;
  amountSol: number;
}): Promise<{ signature: string; amountSol: number; cluster: SolanaCluster }> {
  const connection = getSolanaConnection(params.network);
  const fromPubkey = new PublicKey(params.fromAddress);
  let toPubkey: PublicKey;
  try {
    toPubkey = new PublicKey(params.recipientAddress.trim());
  } catch {
    throw new Error('Enter a valid destination Solana wallet address.');
  }

  const lamports = solToLamports(params.amountSol);
  if (lamports <= 0) {
    throw new Error('Withdrawal amount must be greater than 0 SOL.');
  }

  const currentLamports = Number(await connection.getBalance(fromPubkey, 'confirmed'));
  const feeReserve = params.network === 'Mainnet-Beta' ? 10_000 : 5_000;
  if (lamports + feeReserve > currentLamports) {
    const maxSol = Math.max(0, lamportsToSol(currentLamports - feeReserve));
    throw new Error(
      `Insufficient SOL balance. Maximum withdrawable after network fee is ${maxSol.toFixed(6)} SOL.`
    );
  }

  const instructions: TransactionInstruction[] = [
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    }),
  ];

  const signature = await signAndSendInstructions(
    connection,
    params.network,
    instructions,
    params.provider,
    fromPubkey
  );

  return {
    signature,
    amountSol: params.amountSol,
    cluster: params.network,
  };
}

export async function withdrawSplTokenOnChain(params: {
  network: SolanaCluster;
  provider: WalletProviderId | null;
  fromAddress: string;
  recipientAddress: string;
  mintAddress: string;
  sourceTokenAccount?: string;
  amountUi: number;
  decimals: number;
  programId?: string;
}): Promise<{ signature: string; amountUi: number; cluster: SolanaCluster }> {
  const connection = getSolanaConnection(params.network);
  const owner = new PublicKey(params.fromAddress);
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(params.recipientAddress.trim());
  } catch {
    throw new Error('Enter a valid destination Solana wallet address.');
  }
  const mint = new PublicKey(params.mintAddress);
  const tokenProgramId =
    params.programId === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const rawAmount = toRawTokenAmount(params.amountUi, params.decimals);
  if (rawAmount <= 0n) {
    throw new Error('Withdrawal amount must be greater than 0.');
  }

  const sourceAccount = params.sourceTokenAccount
    ? new PublicKey(params.sourceTokenAccount)
    : await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

  const destAta = await getAssociatedTokenAddress(
    mint,
    recipient,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const instructions: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      destAta,
      recipient,
      mint,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),
    createTransferCheckedInstruction(
      sourceAccount,
      mint,
      destAta,
      owner,
      rawAmount,
      params.decimals,
      [],
      tokenProgramId
    ),
  ];

  const signature = await signAndSendInstructions(
    connection,
    params.network,
    instructions,
    params.provider,
    owner
  );

  return {
    signature,
    amountUi: params.amountUi,
    cluster: params.network,
  };
}

// ---------- 3. REAL ON-CHAIN SPL / LP BURN & RENT RECLAIM ----------

export async function burnSplTokenOnChain(params: {
  network: SolanaCluster;
  provider: WalletProviderId | null;
  ownerAddress: string;
  tokenAccountAddress: string;
  mintAddress: string;
  amountUi: number;
  decimals: number;
  programId?: string;
}): Promise<{ signature: string; cluster: SolanaCluster }> {
  const connection = getSolanaConnection(params.network);
  const owner = new PublicKey(params.ownerAddress);
  const tokenAccount = new PublicKey(params.tokenAccountAddress);
  const mint = new PublicKey(params.mintAddress);
  const tokenProgramId =
    params.programId === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const rawAmount = toRawTokenAmount(params.amountUi, params.decimals);
  if (rawAmount <= 0n) {
    throw new Error('Burn amount must be greater than 0.');
  }

  const instructions: TransactionInstruction[] = [
    createBurnCheckedInstruction(
      tokenAccount,
      mint,
      owner,
      rawAmount,
      params.decimals,
      [],
      tokenProgramId
    ),
  ];

  const signature = await signAndSendInstructions(
    connection,
    params.network,
    instructions,
    params.provider,
    owner
  );
  return { signature, cluster: params.network };
}

export async function closeEmptyTokenAccountOnChain(params: {
  network: SolanaCluster;
  provider: WalletProviderId | null;
  ownerAddress: string;
  tokenAccountAddress: string;
  programId?: string;
}): Promise<{ signature: string; cluster: SolanaCluster }> {
  const connection = getSolanaConnection(params.network);
  const owner = new PublicKey(params.ownerAddress);
  const tokenAccount = new PublicKey(params.tokenAccountAddress);
  const tokenProgramId =
    params.programId === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const instructions: TransactionInstruction[] = [
    createCloseAccountInstruction(
      tokenAccount,
      owner,
      owner,
      [],
      tokenProgramId
    ),
  ];

  const signature = await signAndSendInstructions(
    connection,
    params.network,
    instructions,
    params.provider,
    owner
  );
  return { signature, cluster: params.network };
}

// ---------- 4. REAL ON-CHAIN JUPITER v6 SWAP ----------

export async function executeJupiterSwapOnChain(params: {
  network: SolanaCluster;
  provider: WalletProviderId | null;
  userPublicKey: string;
  quoteResponse: Record<string, unknown>;
}): Promise<{ signature: string; cluster: SolanaCluster }> {
  if (params.network !== 'Mainnet-Beta') {
    throw new Error(
      'Jupiter v6 AMM liquidity aggregation executes on Solana Mainnet-Beta. Switch cluster to Mainnet-Beta in Wallet to execute live swaps.'
    );
  }

  const res = await fetch('/api/solana/jupiter-swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userPublicKey: params.userPublicKey,
      quoteResponse: params.quoteResponse,
    }),
  });
  const data = (await res.json()) as { swapTransaction?: string; error?: string };
  if (!res.ok || !data.swapTransaction) {
    throw new Error(data.error || 'Could not construct Jupiter v6 swap transaction.');
  }

  const txBytes = Buffer.from(data.swapTransaction, 'base64');
  const versionedTx = VersionedTransaction.deserialize(txBytes);
  const connection = getSolanaConnection(params.network);

  const signature = await signAndSendPrebuiltVersionedTx(
    connection,
    versionedTx,
    params.provider,
    params.userPublicKey
  );

  return { signature, cluster: params.network };
}
