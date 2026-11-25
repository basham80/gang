import { ExternalLink } from 'lucide-react';
import {
  getTokenExternalLinks,
  type SolanaCluster,
} from '../utils/solanaLogic';

interface TokenExplorerLinksProps {
  address: string;
  symbol: string;
  pairAddress?: string;
  dexUrl?: string;
  network?: SolanaCluster;
  /** 'compact' renders inline text links (for tables/rows); 'buttons' renders crisp bordered links (for inspector/cards) */
  variant?: 'compact' | 'buttons';
  /** Show Raydium Pools link alongside Raydium Swap */
  showPools?: boolean;
  /** Also show Meteora DLMM link (e.g., for Meteora pools) */
  showMeteora?: boolean;
  className?: string;
}

export function TokenExplorerLinks({
  address,
  symbol,
  pairAddress,
  dexUrl,
  network = 'Mainnet-Beta',
  variant = 'compact',
  showPools = false,
  showMeteora = false,
  className = '',
}: TokenExplorerLinksProps) {
  const links = getTokenExternalLinks(address, network, pairAddress);
  const dexHref = dexUrl || links.dexscreener;

  const items: Array<{ label: string; href: string; ariaLabel: string }> = [
    {
      label: 'Solscan',
      href: links.solscan,
      ariaLabel: `View ${symbol} on Solscan`,
    },
    {
      label: 'DexScreener',
      href: dexHref,
      ariaLabel: `View ${symbol} live chart on DexScreener`,
    },
    {
      label: showPools ? 'Raydium Swap' : 'Raydium',
      href: links.raydiumSwap,
      ariaLabel: `Trade ${symbol} on Raydium`,
    },
  ];

  if (showPools) {
    items.push({
      label: 'Raydium Pools',
      href: links.raydiumPools,
      ariaLabel: `View ${symbol} liquidity pools on Raydium`,
    });
  }

  if (showMeteora) {
    items.push({
      label: 'Meteora',
      href: links.meteoraPools,
      ariaLabel: `View ${symbol} DLMM pools on Meteora`,
    });
  }

  if (variant === 'buttons') {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {items.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.ariaLabel}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#090D16] border border-slate-800 hover:border-emerald-500/50 text-xs font-medium text-slate-300 hover:text-emerald-300 transition-colors whitespace-nowrap"
          >
            <span>{item.label}</span>
            <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-400 ${className}`}
    >
      {items.map((item, idx) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          {idx > 0 && (
            <span aria-hidden="true" className="text-slate-700">
              ·
            </span>
          )}
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.ariaLabel}
            className="inline-flex items-center gap-0.5 hover:text-emerald-400 transition-colors whitespace-nowrap"
          >
            <span>{item.label}</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-65" />
          </a>
        </span>
      ))}
    </div>
  );
}
