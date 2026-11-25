import {
  ArrowUp,
  BadgeCheck,
  ExternalLink,
  Megaphone,
  Plus,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  Announcement,
  AnnouncementCategory,
  SolanaToken,
  WalletState,
} from '../types/solana';
import {
  formatRelativeTime,
  getSolscanAccountUrl,
  getSolscanTxUrl,
  isLikelySolanaAddress,
  resolveTokenAddressBySymbol,
  shortenAddress,
} from '../utils/solanaLogic';
import { TokenExplorerLinks } from './TokenExplorerLinks';

interface AnnouncementsViewProps {
  announcements: Announcement[];
  tokens: SolanaToken[];
  wallet: WalletState;
  onAnnouncementCreated: (announcement: Announcement) => void;
  onUpvote: (id: string) => void;
  onInspectTokenBySymbol: (symbol: string) => void;
}

export function AnnouncementsView({
  announcements,
  tokens,
  wallet,
  onAnnouncementCreated,
  onUpvote,
  onInspectTokenBySymbol,
}: AnnouncementsViewProps) {
  const [filter, setFilter] = useState<'All' | AnnouncementCategory>('All');
  const [composerOpen, setComposerOpen] = useState(false);

  const [category, setCategory] = useState<AnnouncementCategory>('Launch');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [author, setAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'All') return announcements;
    return announcements.filter((a) => a.category === filter);
  }, [announcements, filter]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (title.trim().length < 6) {
      setError('Headline must be at least 6 characters.');
      return;
    }
    if (body.trim().length < 16) {
      setError('Announcement body must be at least 16 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          title: title.trim(),
          body: body.trim(),
          tokenSymbol: tokenSymbol || undefined,
          author: author.trim() || (wallet.connected ? wallet.providerLabel : 'Solana Builder'),
          walletAddress: wallet.connected ? wallet.address : undefined,
        }),
      });
      const data = (await res.json()) as {
        announcement?: Announcement;
        error?: string;
      };
      if (!res.ok || !data.announcement) {
        throw new Error(data.error || 'Failed to broadcast announcement.');
      }

      onAnnouncementCreated(data.announcement);
      setTitle('');
      setBody('');
      setTokenSymbol('');
      setAuthor('');
      setComposerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Broadcast failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const categories: Array<'All' | AnnouncementCategory> = [
    'All',
    'Launch',
    'Boost',
    'Network',
    'Security',
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50">
            Network Announcements
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Verified Solana protocol upgrades, SPL token launches, boost activations, and developer advisories.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setComposerOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors self-start sm:self-auto whitespace-nowrap"
        >
          {composerOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          <span>{composerOpen ? 'Close Composer' : 'Broadcast Announcement'}</span>
        </button>
      </div>

      {/* Broadcast Composer */}
      {composerOpen && (
        <form
          onSubmit={handlePublish}
          noValidate
          className="rounded-xl bg-[#0F1624] border border-slate-800 p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-emerald-400" />
            <h2 className="font-display text-base font-semibold text-slate-100">
              Broadcast to Solana Network Portal
            </h2>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="ann-category"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Category
              </label>
              <select
                id="ann-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
                className="w-full px-3 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
              >
                <option value="Launch">Launch</option>
                <option value="Boost">Boost</option>
                <option value="Network">Network</option>
                <option value="Security">Security</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="ann-token"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Linked Token (Optional)
              </label>
              <select
                id="ann-token"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
              >
                <option value="">Network-wide (no single token)</option>
                {tokens.map((t) => (
                  <option key={t.address} value={t.symbol}>
                    {t.symbol} — {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="ann-author"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Team or Dev Handle
              </label>
              <input
                id="ann-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. YABBAI Core Labs"
                className="w-full px-3 py-2 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ann-title"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Announcement Headline
            </label>
            <input
              id="ann-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Liquidity Pool Lock Extended to 24 Months on Raydium"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
          </div>

          <div>
            <label
              htmlFor="ann-body"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Details
            </label>
            <textarea
              id="ann-body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Include verifiable milestones, tx notes, or upgrade impact..."
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#090D16] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors"
            >
              {submitting ? 'Publishing...' : 'Publish to Network'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div
        role="tablist"
        aria-label="Filter announcements by category"
        className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#0F1624] border border-slate-800"
      >
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={filter === cat}
            onClick={() => setFilter(cat)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === cat
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Stream */}
      <div className="rounded-xl bg-[#0F1624] border border-slate-800/80 divide-y divide-slate-800/70">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No announcements found in the {filter} category yet.
          </div>
        ) : (
          filtered.map((item) => (
            <article
              key={item.id}
              className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
            >
              <div className="space-y-2 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span
                    className={`font-semibold ${
                      item.category === 'Boost'
                        ? 'text-amber-400'
                        : item.category === 'Security'
                          ? 'text-sky-400'
                          : 'text-emerald-400'
                    }`}
                  >
                    {item.category}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-slate-300">
                    {item.author}
                    {item.verified && (
                      <BadgeCheck
                        className="w-3.5 h-3.5 text-emerald-400"
                        aria-label="Verified sender"
                      />
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  {isLikelySolanaAddress(item.walletAddress) ? (
                    <a
                      href={getSolscanAccountUrl(item.walletAddress, wallet.network)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-slate-400 hover:text-emerald-400 transition-colors"
                    >
                      <span>{shortenAddress(item.walletAddress)}</span>
                      <ExternalLink className="w-3 h-3 opacity-70" />
                    </a>
                  ) : (
                    <span className="font-mono text-slate-500">
                      {item.walletAddress}
                    </span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeTime(item.createdAt)}</span>
                </div>

                <h2 className="font-display text-base sm:text-lg font-semibold text-slate-100 leading-snug">
                  {item.title}
                </h2>

                <p className="text-sm text-slate-400 leading-relaxed">
                  {item.body}
                </p>

                {(item.tokenSymbol || item.tokenAddress || item.txSignature) && (
                  <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {item.tokenSymbol && (
                      <button
                        type="button"
                        onClick={() => onInspectTokenBySymbol(item.tokenSymbol!)}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Inspect {item.tokenSymbol} in Token Gainer →
                      </button>
                    )}
                    {(() => {
                      const mint =
                        item.tokenAddress ||
                        (item.tokenSymbol
                          ? resolveTokenAddressBySymbol(item.tokenSymbol, tokens)
                          : null);
                      const matched = mint
                        ? tokens.find((t) => t.address === mint)
                        : undefined;
                      return mint ? (
                        <TokenExplorerLinks
                          address={mint}
                          symbol={item.tokenSymbol || matched?.symbol || 'SPL'}
                          pairAddress={matched?.pairAddress}
                          network={matched?.cluster ?? wallet.network}
                          variant="compact"
                          showPools
                        />
                      ) : null;
                    })()}
                    {item.txSignature && (
                      <a
                        href={getSolscanTxUrl(item.txSignature, wallet.network)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-emerald-300 hover:text-emerald-200"
                      >
                        <span>Tx {shortenAddress(item.txSignature)}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="shrink-0 flex sm:flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => onUpvote(item.id)}
                  aria-label={`Endorse announcement ${item.title}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#090D16] border border-slate-800 hover:border-slate-700 text-xs font-mono tabular-nums text-slate-200 transition-colors"
                >
                  <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{item.upvotes}</span>
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
