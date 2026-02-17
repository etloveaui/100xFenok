// Navigation Types
export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  active?: boolean;
}

export interface NavDropdown {
  label: string;
  items: NavDropdownItem[];
}

export interface NavDropdownItem {
  label: string;
  href: string;
  description?: string;
  icon?: string;
  color?: 'gold' | 'interactive' | 'rose' | 'green';
}

// Market Data Types
export interface IndexData {
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface VIXData {
  price: number;
  change: number;
  changePercent: number;
  regime: {
    label: string;
    color: 'green' | 'blue' | 'orange' | 'red' | 'gray';
  };
}

export interface SectorData {
  sym: string;
  name: string;
  changePercent: number;
  weight?: number;
}

export type MarketState = 'REGULAR' | 'PRE' | 'POST' | 'CLOSED';

export interface MarketData {
  indices: {
    '^GSPC': IndexData;
    '^IXIC': IndexData;
    '^DJI': IndexData;
  };
  vix: VIXData;
  marketState: MarketState;
  sectors: Record<string, SectorData>;
}

// Heatmap Types
export interface HeatmapCellProps {
  symbol: string;
  name: string;
  changePercent: number;
  weight: number;
}

// Footer Types
export type FooterMarketStatus = 'regular' | 'pre' | 'after' | 'overnight' | 'closed';

export interface FooterTickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
}

// UI Types
export interface BentoCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export interface MarketPulseProps {
  data?: MarketData;
  loading?: boolean;
  error?: boolean;
}
