import React, { useState, useEffect } from 'react'
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

  // Consume a form passed in via deep link (?form=id)
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
    } catch {
      // backend may not be ready yet
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  const handleSeedDemo = async () => {
    setSeeding(true)
    try {
      await seedDemo()
      await load()
    } catch {
      // ignore
    } finally {
      setSeeding(false)
    }
  }

  const filtered = forms.filter(f =>
    !search || f.title.toLowerCase().includes(search.toLowerCase()) ||
    f.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      {/* Hero */}
      <div className="mb-8 text-center">
        <h1 className="display text-4xl font-700 text-balance mb-3" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
          Funded commitments.
        </h1>
        <p className="text-lg text-pretty" style={{ color: 'var(--muted)' }}>
          Answer a form, pay USDC. Your money only moves when the goal is met.
        </p>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Search className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search forms..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
          style={{ color: 'var(--ink)' }}
        />
        <button onClick={() => { void load() }} className="hover:opacity-60 transition-opacity">
          <RefreshCw className="size-4" style={{ color: 'var(--subtle)' }} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-lg font-medium" style={{ color: 'var(--ink)' }}>
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
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {seeding ? <Loader2 className="size-4 animate-spin" /> : null}
                {seeding ? 'Seeding...' : 'Load demo workshop'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map(form => (
            <FormCard key={form.id} form={form} onClick={() => setSelectedForm(form)} />
          ))}
        </div>
      )}

      {/* Form flow modal */}
      <AnimatePresence>
        {selectedForm && (
          <FormFlow
            form={selectedForm}
            onClose={() => { setSelectedForm(null); void load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
