import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Search, Loader2, RefreshCw } from 'lucide-react'
import type { PactForm } from '../types'
import { FormCard } from './FormCard'
import { FormFlow } from './FormFlow'
import { getPublishedForms, seedDemo } from '../api'

interface ExploreViewProps {
  initialOpenForm?: PactForm | null
  onOpenFormConsumed?: () => void
}

export function ExploreView({ initialOpenForm, onOpenFormConsumed }: ExploreViewProps) {
  const [forms, setForms] = useState<PactForm[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedForm, setSelectedForm] = useState<PactForm | null>(null)
  const [search, setSearch] = useState('')
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    if (initialOpenForm) {
      setSelectedForm(initialOpenForm)
      onOpenFormConsumed?.()
    }
  }, [initialOpenForm, onOpenFormConsumed])

  const load = async () => {
    setLoading(true)
    try {
      const data = await getPublishedForms()
      setForms(data)
    } catch { /* backend not ready */ }
    finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  const handleSeedDemo = async () => {
    setSeeding(true)
    try { await seedDemo(); await load() } catch { /* ignore */ }
    finally { setSeeding(false) }
  }

  const filtered = forms.filter(f =>
    !search ||
    f.title.toLowerCase().includes(search.toLowerCase()) ||
    f.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 page-enter">
      {/* Hero */}
      <div className="mb-10 text-center">
        <h1
          className="text-balance mb-3"
          style={{
            fontFamily: "'Architects Daughter', cursive",
            fontSize: 'clamp(36px, 6vw, 54px)',
            lineHeight: 1.1,
            color: 'var(--ink)',
          }}
        >
          Funded commitments.
        </h1>
        <p
          className="text-lg text-pretty max-w-md mx-auto"
          style={{ color: 'var(--muted)', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
        >
          Answer a form, pay USDC. Your money only moves when the goal is met.
        </p>
      </div>

      {/* Search bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 mb-8"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '3px',
          boxShadow: 'rgba(29,31,36,0.06) 2px 2px 0px 0px',
        }}
      >
        <Search className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search forms..."
          className="flex-1 text-sm"
          style={{
            border: 'none',
            borderBottom: 'none',
            padding: 0,
            fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          }}
        />
        <button
          onClick={() => { void load() }}
          className="hover:opacity-60 transition-opacity"
          aria-label="Refresh"
        >
          <RefreshCw className="size-4" style={{ color: 'var(--subtle)' }} />
        </button>
      </div>

      {/* States */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="size-7 animate-spin" style={{ color: 'var(--accent)' }} />
          <p style={{ color: 'var(--muted)', fontFamily: "'Architects Daughter', cursive" }}>Loading forms…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-5">
          <p
            className="text-xl"
            style={{ fontFamily: "'Architects Daughter', cursive", color: 'var(--ink)' }}
          >
            {search ? 'No forms found.' : 'No forms published yet.'}
          </p>
          {!search && (
            <>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                Seed the demo workshop to see a real example, or create your own.
              </p>
              <button
                onClick={() => { void handleSeedDemo() }}
                disabled={seeding}
                className="btn-primary disabled:opacity-50"
              >
                {seeding ? <Loader2 className="size-4 animate-spin" /> : null}
                {seeding ? 'Seeding…' : 'Load demo workshop'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {filtered.map(form => (
            <FormCard key={form.id} form={form} onClick={() => setSelectedForm(form)} />
          ))}
        </div>
      )}

      {/* FormFlow modal */}
      <AnimatePresence>
        {selectedForm && (
          <FormFlow form={selectedForm} onClose={() => setSelectedForm(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
