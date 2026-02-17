'use client';

import { useState } from 'react';
import Link from 'next/link';
import { NavDropdown, NavDropdownItem, MobileNavItem } from '@/types';

const marketDropdown: NavDropdown = {
  label: 'MARKET',
  items: [
    { label: 'Market Wrap', href: '/posts', description: 'Daily Updates', color: 'gold' },
    { label: 'Insights', href: '/posts', description: 'Weekly Deep Dive', color: 'interactive' },
  ],
};

const analyticsDropdown: NavDropdown = {
  label: 'ANALYTICS',
  items: [
    { label: 'Insights', href: '/posts', icon: 'fa-lightbulb', color: 'gold' },
    { label: 'IB Helper', href: '/ib', icon: 'fa-calculator', color: 'interactive' },
    { label: 'V/R', href: '/vr', icon: 'fa-balance-scale', color: 'gold' },
  ],
};

const strategiesDropdown: NavDropdown = {
  label: 'STRATEGIES',
  items: [
    { label: 'IB Helper (무한매수)', href: '/ib', description: 'V2.2 실사용 계산기', color: 'rose' },
    { label: 'Value Rebalancing', href: '/vr', description: 'Asset allocation optimization', color: 'gold' },
  ],
};

const iconNavItems = [
  { href: '/', icon: 'fa-home', title: 'Dashboard' },
  { href: '/posts', icon: 'fa-chart-bar', title: 'Market' },
  { href: '/posts', icon: 'fa-chart-line', title: 'Analytics' },
  { href: '/ib', icon: 'fa-lightbulb', title: 'Strategies' },
];

const mobileNavItems: MobileNavItem[] = [
  { label: 'DASHBOARD', href: '/', icon: 'fa-home' },
  {
    label: 'MARKET',
    icon: 'fa-chart-bar',
    items: [
      { label: 'Market Wrap', href: '/posts' },
      { label: 'Insights', href: '/posts' },
    ],
  },
  {
    label: 'ANALYTICS',
    icon: 'fa-chart-line',
    items: [
      { label: 'Insights', href: '/posts' },
      { label: 'IB Helper', href: '/ib' },
    ],
  },
  {
    label: 'STRATEGIES',
    icon: 'fa-lightbulb',
    items: [
      { label: 'IB Helper (무한매수)', href: '/ib' },
      { label: 'Value Rebalancing', href: '/vr' },
    ],
  },
];

function getColorClasses(color?: string) {
  switch (color) {
    case 'gold':
      return 'bg-brand-gold/20 text-brand-gold group-hover/link:bg-brand-gold/30';
    case 'interactive':
      return 'bg-blue-100 text-blue-600 group-hover/link:bg-blue-200';
    case 'rose':
      return 'bg-rose-100 text-rose-600 group-hover/link:bg-rose-200';
    case 'green':
      return 'bg-green-100 text-green-600 group-hover/link:bg-green-200';
    default:
      return 'bg-slate-100 text-slate-600 group-hover/link:bg-slate-200';
  }
}

function getTextColorClass(color?: string) {
  switch (color) {
    case 'interactive':
      return 'text-brand-interactive';
    case 'gold':
      return 'text-brand-navy';
    default:
      return 'text-brand-navy';
  }
}

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <nav className="relative w-full z-50" id="mainNav">
        <div className="nav-wrapper w-full bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border-b border-gray-100 sticky top-0">
          <div className="container mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
            {/* Brand */}
            <Link href="/" className="flex items-center gap-2 sm:gap-3 group flex-shrink-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-xl flex items-center justify-center shadow-md group-hover:scale-105 transition-transform border border-slate-100">
                <svg className="h-6 w-6 sm:h-8 sm:w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="24" height="24" rx="4" fill="#010079"/>
                  <text x="12" y="17" textAnchor="middle" fill="#D5AD36" fontSize="14" fontWeight="bold" fontFamily="Orbitron">100</text>
                </svg>
              </div>
              <span className="font-[900] orbitron text-slate-800 text-lg sm:text-xl leading-none tracking-tight">
                100x <span className="text-brand-gold">FENOK</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1 ml-6">
              {/* DASHBOARD */}
              <Link
                href="/"
                className="h-10 flex items-center px-4 text-xs font-[800] text-brand-navy border-b-2 border-brand-navy bg-blue-50/50 rounded-t-lg orbitron tracking-wide"
              >
                DASHBOARD
              </Link>

              <div className="h-4 w-[1px] bg-gray-200 mx-1" />

              {/* MARKET Dropdown */}
              <div className="relative h-full flex items-center group">
                <button className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm">
                  {marketDropdown.label}
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-2 min-w-[220px] z-50">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 mb-1">Briefing</div>
                  {marketDropdown.items.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="flex items-center px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg group/link transition-colors"
                    >
                      <span className={`w-1 h-4 rounded-full mr-3 opacity-0 group-hover/link:opacity-100 transition-opacity ${
                        item.color === 'gold' ? 'bg-brand-gold' : 'bg-brand-interactive'
                      }`} />
                      <div>
                        <span className="block font-bold text-slate-700">{item.label}</span>
                        {item.description && (
                          <span className="text-[10px] text-slate-400">{item.description}</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* ANALYTICS Dropdown */}
              <div className="relative h-full flex items-center group">
                <button className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm"
                >
                  {analyticsDropdown.label}
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-4 min-w-[360px] z-50">
                  <div className="px-1 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 mb-2">Tools & Charts</div>
                  <div className="grid grid-cols-3 gap-2">
                    {analyticsDropdown.items.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card"
                      >
                        <i className={`fas ${item.icon} text-xl mb-2 group-hover/card:scale-110 transition-transform ${
                          item.color === 'interactive' ? 'text-brand-interactive' : 'text-brand-navy'
                        }`} />
                        <span className="text-xs font-bold text-slate-700">{item.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* STRATEGIES Dropdown */}
              <div className="relative h-full flex items-center group">
                <button className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm"
                >
                  {strategiesDropdown.label}
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full right-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-3 min-w-[280px] z-50">
                  <div className="px-2 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 mb-2">Proven Methods</div>
                  {strategiesDropdown.items.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="flex items-start p-2 rounded-lg hover:bg-slate-50 transition-colors mb-1 group/strat"
                    >
                      <div className={`w-8 h-8 rounded flex items-center justify-center mr-3 mt-0.5 transition-colors ${getColorClasses(item.color)}`}>
                        <i className={`fas ${
                          item.label.includes('IB') ? 'fa-calculator' : 
                          item.label.includes('Infinite') ? 'fa-infinity' : 'fa-balance-scale'
                        } text-xs`} />
                      </div>
                      <div>
                        <span className={`block text-sm font-bold text-slate-700 group-hover/strat:${getTextColorClass(item.color)}`}>
                          {item.label}
                        </span>
                        {item.description && (
                          <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">{item.description}</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </nav>

            {/* Tablet Icon Navigation */}
            <nav className="hidden sm:flex md:hidden items-center gap-1 ml-4">
              {iconNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.title}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm transition-colors ${
                    item.href === '/' 
                      ? 'bg-brand-navy text-white' 
                      : 'text-slate-500 hover:text-brand-navy hover:bg-slate-100'
                  }`}
                >
                  <i className={`fas ${item.icon}`} />
                </Link>
              ))}
            </nav>

            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden w-11 h-11 rounded-lg bg-slate-50 text-slate-500 hover:bg-brand-navy hover:text-white transition-all border border-slate-100 shadow-sm flex items-center justify-center"
              aria-label="Open menu"
            >
              <i className="fas fa-bars text-sm" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div className={`mobile-menu fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-white shadow-2xl z-50 ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <span className="font-bold orbitron text-slate-800">MENU</span>
          <button 
            onClick={() => setMobileMenuOpen(false)}
            className="w-11 h-11 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center"
          >
            <i className="fas fa-times text-slate-600" />
          </button>
        </div>

        <div className="p-4 pt-12 space-y-2 overflow-y-auto h-[calc(100vh-5rem)]">
          {/* Dashboard */}
          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-4 py-3 rounded-lg bg-blue-50 border-l-4 border-brand-navy font-bold text-sm text-brand-navy"
          >
            <i className="fas fa-home mr-2" /> DASHBOARD
          </Link>

          {/* Dropdown Sections */}
          {mobileNavItems.slice(1).map((section) => (
            <details key={section.label} className="group">
              <summary className="px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm text-slate-700 list-none flex items-center justify-between">
                <span>
                  <i className={`fas ${section.icon} mr-2`} /> {section.label}
                </span>
                <i className="fas fa-chevron-down text-xs text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="ml-4 mt-1 space-y-1">
                {section.items?.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>

      {/* Mobile Overlay */}
      <div 
        className={`mobile-overlay fixed inset-0 bg-black/50 z-40 ${mobileMenuOpen ? 'visible' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />
    </>
  );
}
