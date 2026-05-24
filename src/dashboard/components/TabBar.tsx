import React from 'react';

/**
 * TabBar — Bottom navigation for mobile, hidden on desktop.
 * Displays the first 5 tabs with icons; remaining tabs accessible via "More" menu.
 */

export interface TabItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  // Show max 5 tabs on mobile bottom bar
  const visibleTabs = tabs.slice(0, 5);
  const overflowTabs = tabs.slice(5);
  const [showMore, setShowMore] = React.useState(false);

  const isOverflowActive = overflowTabs.some((t) => t.id === activeTab);

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50"
      aria-label="Tab navigation"
    >
      {/* Overflow menu */}
      {showMore && overflowTabs.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
          {overflowTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                onTabChange(tab.id);
                setShowMore(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-around px-2 py-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              onTabChange(tab.id);
              setShowMore(false);
            }}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors min-w-0 flex-1 ${
              activeTab === tab.id
                ? 'text-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="relative">
              {tab.icon}
              {tab.badge != null && tab.badge > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              )}
            </span>
            <span className="truncate max-w-[60px]">{tab.label}</span>
          </button>
        ))}

        {/* More button for overflow tabs */}
        {overflowTabs.length > 0 && (
          <button
            onClick={() => setShowMore(!showMore)}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors min-w-0 flex-1 ${
              isOverflowActive || showMore
                ? 'text-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            aria-expanded={showMore}
            aria-label="More tabs"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
            <span>More</span>
          </button>
        )}
      </div>
    </nav>
  );
}
