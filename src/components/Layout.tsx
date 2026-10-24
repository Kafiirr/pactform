import React from 'react'
import { ConnectKitButton } from 'connectkit'
import { Compass, PlusSquare, FileText, LayoutDashboard } from 'lucide-react'

type Tab = 'explore' | 'create' | 'my-forms' | 'dashboard'

interface LayoutProps {
  children: React.ReactNode
  activeTab?: Tab
  onTabChange?: (tab: Tab) => void
}

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'explore',    label: 'Explore',    icon: <Compass className="size-4" /> },
  { id: 'create',     label: 'Create',     icon: <PlusSquare className="size-4" /> },
  { id: 'my-forms',   label: 'My Forms',   icon: <FileText className="size-4" /> },
  { id: 'dashboard',  label: 'Dashboard',  icon: <LayoutDashboard className="size-4" /> },
]

export function Layout({ children, activeTab, onTabChange }: LayoutProps) {
  return (
    <div className="min-h-dvh flex flex-col">
      {/* Header */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3"
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          boxShadow: 'rgba(29,31,36,0.08) 0px 2px 0px 0px',
        }}
      >
        {/* Logo */}
        <button
          onClick={() => onTabChange?.('explore')}
          className="flex items-center gap-2 hover:opacity-75 transition-opacity"
        >
          {/* Hand-drawn lightning mark */}
          <div
            className="flex size-8 items-center justify-center"
            style={{
              background: 'var(--accent)',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              boxShadow: 'rgba(29,31,36,0.9) 2px 2px 0px 0px',
            }}
          >
            <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
              <path d="M9 1L2 9h5l-2 6 7-8H7l2-6z" fill="#fbfaf6" stroke="#fbfaf6" strokeWidth="0.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontFamily: "'Architects Daughter', cursive", fontSize: '22px', color: 'var(--ink)', lineHeight: 1 }}>
            Pactform
          </span>
        </button>

        {/* Desktop nav */}
        {onTabChange && (
          <nav className="hidden md:flex items-center gap-1">
            {tabs.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all"
                  style={{
                    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fbfaf6' : 'var(--muted)',
                    border: active ? '1px solid var(--accent)' : '1px solid transparent',
                    borderRadius: '4px',
                    boxShadow: active ? 'rgba(29,31,36,0.5) 2px 2px 0px 0px' : 'none',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        )}

        {/* Wallet */}
        <div className="scale-90 sm:scale-100 origin-right">
          <ConnectKitButton />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>

      {/* Desktop footer */}
      <footer
        className="hidden md:block py-5 px-6 text-center text-xs"
        style={{
          borderTop: '1px solid var(--border-light)',
          color: 'var(--subtle)',
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        Pactform — Turn "I'm interested" into "I'm in." Built on Arc with USDC.
      </footer>

      {/* Mobile bottom tab bar */}
      {onTabChange && (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-50 flex items-stretch"
          style={{
            background: 'var(--surface)',
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
                style={{
                  color: active ? 'var(--accent)' : 'var(--muted)',
                  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                }}
              >
                {tab.icon}
                <span className="text-[10px] font-medium">{tab.label}</span>
                {active && (
                  <span
                    className="absolute bottom-0 h-[2px] w-8"
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
