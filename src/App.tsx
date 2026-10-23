import React, { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { ExploreView } from './components/ExploreView'
import { FormBuilder } from './components/FormBuilder'
import { CreatorDashboard } from './components/CreatorDashboard'
import { RespondentDashboard } from './components/RespondentDashboard'
import type { PactForm } from './types'

type Tab = 'explore' | 'create' | 'dashboard' | 'my-forms'

export default function App() {
  const [tab, setTab] = useState<Tab>('explore')
  const [deepLinkForm, setDeepLinkForm] = useState<PactForm | null>(null)

  // Read ?form=<id> from URL on first load and auto-open that form
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const formId = params.get('form')
    if (!formId) return
    fetch(`/api/forms/${formId}`)
      .then(r => r.ok ? r.json() as Promise<{ form: PactForm }> : Promise.reject(new Error('not found')))
      .then(data => { setDeepLinkForm(data.form) })
      .catch(() => {})
  }, [])

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'explore' && (
        <ExploreView
          initialOpenForm={deepLinkForm}
          onOpenFormConsumed={() => setDeepLinkForm(null)}
        />
      )}
      {tab === 'create' && (
        <FormBuilder
          onSave={() => setTab('my-forms')}
          onCancel={() => setTab('explore')}
        />
      )}
      {tab === 'my-forms' && <CreatorDashboard />}
      {tab === 'dashboard' && <RespondentDashboard />}
    </Layout>
  )
}
