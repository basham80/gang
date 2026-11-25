import {
  ArrowLeftRight,
  Bell,
  Cloud,
  Droplets,
  Megaphone,
  Radio,
  ReceiptText,
  Rocket,
  TrendingUp,
  X,
} from 'lucide-react';
import type { AppSection, AuthUserSummary } from '../types/solana';

interface SidebarProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  unacknowledgedAlertsCount: number;
  announcementsCount: number;
  poolsCount: number;
  transactionsCount: number;
  authUser: AuthUserSummary | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const EMBLEM_SRC = '/src/assets/images/yabbai_brand_emblem_1795503420361.jpg';

export function Sidebar({
  activeSection,
  onSelectSection,
  unacknowledgedAlertsCount,
  announcementsCount,
  poolsCount,
  transactionsCount,
  authUser,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const coreApps: Array<{
    id: AppSection;
    label: string;
    subtitle: string;
    icon: typeof TrendingUp;
    count?: number;
  }> = [
    {
      id: 'gainer',
      label: 'Token Gainer',
      subtitle: 'Live scanner & AI sentiment',
      icon: TrendingUp,
    },
    {
      id: 'launchpad',
      label: 'Launch & Boost',
      subtitle: 'Create, clone & boost coins',
      icon: Rocket,
    },
    {
      id: 'liquidity',
      label: 'Manage Liquidity',
      subtitle: 'Raydium & Meteora pools',
      icon: Droplets,
      count: poolsCount > 0 ? poolsCount : undefined,
    },
    {
      id: 'trade',
      label: 'Multi-Chain Trade',
      subtitle: 'Solana & EVM swap desk',
      icon: ArrowLeftRight,
    },
  ];

  const networkTools: Array<{
    id: AppSection;
    label: string;
    count?: number;
    icon: typeof Megaphone;
  }> = [
    {
      id: 'transactions',
      label: 'Transaction Ledger',
      count: transactionsCount > 0 ? transactionsCount : undefined,
      icon: ReceiptText,
    },
    {
      id: 'xtracker',
      label: 'X Tracker',
      icon: Radio,
    },
    {
      id: 'announcements',
      label: 'Announcements',
      count: announcementsCount,
      icon: Megaphone,
    },
    {
      id: 'alerts',
      label: 'Automated Alerts',
      count: unacknowledgedAlertsCount > 0 ? unacknowledgedAlertsCount : undefined,
      icon: Bell,
    },
  ];

  const handleSelect = (section: AppSection) => {
    onSelectSection(section);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex flex-col h-full bg-[#0C111D] border-r border-slate-800/80">
      {/* Brand Lockup */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800/80 shrink-0">
        <button
          type="button"
          onClick={() => handleSelect('gainer')}
          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-md"
        >
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-slate-700/70 shrink-0 flex items-center justify-center">
            <img
              src={EMBLEM_SRC}
              alt="YABBAI emblem"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap">
            YABBAI
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-2 text-slate-400 hover:text-slate-100 rounded-md"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Sections */}
      <nav
        aria-label="YABBAI Suite Navigation"
        className="flex-1 overflow-y-auto px-3 py-5 space-y-6"
      >
        <div>
          <p className="px-3 mb-2 text-xs font-medium text-slate-500">
            Built-in Apps
          </p>
          <div className="space-y-1">
            {coreApps.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-start justify-between gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-slate-800/90 text-slate-50'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isActive ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-tight whitespace-nowrap truncate">
                        {item.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  {item.count !== undefined && (
                    <span className="font-mono text-xs tabular-nums text-emerald-400 mt-0.5 shrink-0">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-800/70 pt-5">
          <p className="px-3 mb-2 text-xs font-medium text-slate-500">
            Network Portal
          </p>
          <div className="space-y-1">
            {networkTools.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-slate-800/90 text-slate-50'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    />
                    <span className="text-sm font-medium whitespace-nowrap truncate">
                      {item.label}
                    </span>
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        item.id === 'alerts'
                          ? 'text-amber-400 font-semibold'
                          : 'text-slate-500'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Footer Sync Summary */}
      <div className="px-5 py-4 border-t border-slate-800/80 text-xs text-slate-500 leading-relaxed space-y-1">
        <div className="flex items-center gap-1.5 text-slate-300 font-medium">
          <Cloud className={`w-3.5 h-3.5 ${authUser ? 'text-emerald-400' : 'text-slate-500'}`} />
          <span>{authUser ? 'Firestore Sync Active' : 'YABBAI · Yabb + AI'}</span>
        </div>
        <p className="truncate">
          {authUser
            ? authUser.email || authUser.displayName || 'Cloud Vault Signed In'
            : 'Solana Control Panel, Launch Pad & Boost Portal.'}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[248px] shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation drawer"
        >
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-[268px] max-w-[82vw] h-full z-10">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}
