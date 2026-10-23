import React from 'react'
import { ConnectKitButton } from 'connectkit'
import { Zap, Compass, PlusSquare, FileText, LayoutDashboard } from 'lucide-react'

type Tab = 'explore' | 'create' | 'my-forms' | 'dashboard'

interface LayoutProps {
  children: React.ReactNode
  activeTab?: Tab
  onTabChange?: (tab: Tab) => void
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'explore', label: 'Explore', icon: <Compass className="size-5" /> },
  { id: 'create', label: 'Create', icon: <PlusSquare className="size-5" /> },
  { id: 'my-forms', label: 'My Forms', icon: <FileText className="size-5" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-5" /> },
]

export function Layout({ children, activeTab, onTabChange }: LayoutProps) {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-4 py-3"
        style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Logo */}
        <button
          onClick={() => onTabChange?.('explore')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div
            className="flex size-7 items-center justify-center rounded-lg"
            style={{ background: 'var(--accent)' }}
          >
            <Zap className="size-4 text-white fill-white" />
          </div>
          <span className="display text-lg font-700" style={{ color: 'var(--ink)' }}>
            Pactform
          </span>
        </button>

        {/* Desktop nav */}
        {onTabChange && (
          <nav className="hidden md:flex items-center gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: activeTab === tab.id ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab.id ? 'white' : 'var(--muted)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        {/* Wallet — compact on mobile */}
        <div className="scale-90 sm:scale-100 origin-right">
          <ConnectKitButton />
        </div>
      </header>

      {/* Content — add bottom padding on mobile so content isn't hidden under bottom nav */}
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>

      {/* Desktop footer */}
      <footer className="hidden md:block py-6 px-4 text-center text-xs" style={{ color: 'var(--subtle)' }}>
        Pactform — Turn "I'm interested" into "I'm in." Built on Arc with USDC.
      </footer>

      {/* Mobile bottom tab bar */}
      {onTabChange && (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-50 flex items-stretch"
          style={{
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid var(--border)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {tabs.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors"
                style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}
              >
                <span className={active ? 'scale-110 transition-transform' : 'transition-transform'}>
                  {tab.icon}
                </span>
                <span className="text-[10px] font-medium">{tab.label}</span>
                {active && (
                  <span
                    className="absolute bottom-0 h-0.5 w-8 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}
