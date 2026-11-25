import { Cloud, Menu, Wallet } from 'lucide-react';
import type { AppSection, AuthUserSummary, WalletState } from '../types/solana';

interface TopBarProps {
  activeSection: AppSection;
  wallet: WalletState;
  authUser: AuthUserSummary | null;
  onOpenWalletModal: () => void;
  onOpenMobileMenu: () => void;
}

const SECTION_BREADCRUMBS: Record<AppSection, { group: string; title: string }> = {
  gainer: { group: 'Built-in Apps', title: 'Sol Token Gainer' },
  launchpad: { group: 'Built-in Apps', title: 'Launch Pad & Boost Portal' },
  liquidity: { group: 'Built-in Apps', title: 'Manage Liquidity' },
  trade: { group: 'Built-in Apps', title: 'Multi-Chain Trade Desk' },
  transactions: { group: 'Network Portal', title: 'Transaction Ledger' },
  xtracker: { group: 'Network Portal', title: 'X Tracker' },
  announcements: { group: 'Network Portal', title: 'Network Announcements' },
  alerts: { group: 'Network Portal', title: 'Automated Alerts' },
};

export function TopBar({
  activeSection,
  wallet,
  authUser,
  onOpenWalletModal,
  onOpenMobileMenu,
}: TopBarProps) {
  const crumb = SECTION_BREADCRUMBS[activeSection];
  const solBalance = wallet.balances.SOL ?? 0;

  return (
    <header className="h-16 sticky top-0 z-30 bg-[#090D16]/95 backdrop-blur-sm border-b border-slate-800/80 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-6">
      {/* Left: Mobile trigger + Contextual Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/70 transition-colors shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="hidden sm:inline text-slate-500 whitespace-nowrap">
            YABBAI
          </span>
          <span className="hidden sm:inline text-slate-700" aria-hidden="true">
            /
          </span>
          <span className="hidden md:inline text-slate-500 whitespace-nowrap">
            {crumb.group}
          </span>
          <span className="hidden md:inline text-slate-700" aria-hidden="true">
            /
          </span>
          <span className="font-display font-semibold text-slate-100 truncate">
            {crumb.title}
          </span>
        </div>
      </div>

      {/* Right: Single Primary Action (Wallet & Persistent Cloud Vault) */}
      <div className="shrink-0">
        {wallet.connected ? (
          <button
            type="button"
            onClick={onOpenWalletModal}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-slate-900 border border-slate-700/80 hover:border-slate-600 text-sm text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-mono text-xs text-emerald-400 tabular-nums">
              {solBalance.toFixed(2)} SOL
            </span>
            <span className="hidden sm:inline text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline font-mono text-xs text-slate-300">
              {wallet.shortAddress}
            </span>
            {authUser && (
              <Cloud
                className="hidden sm:inline w-3.5 h-3.5 text-emerald-400 shrink-0"
                aria-label="Firestore cloud sync active"
              />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenWalletModal}
            className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Wallet className="w-4 h-4 shrink-0" />
            <span>Connect Wallet</span>
          </button>
        )}
      </div>
    </header>
  );
}
