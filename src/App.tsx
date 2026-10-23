import React, { useState } from 'react'
import { Layout } from './components/Layout'
import { ExploreView } from './components/ExploreView'
import { FormBuilder } from './components/FormBuilder'
import { CreatorDashboard } from './components/CreatorDashboard'
import { RespondentDashboard } from './components/RespondentDashboard'

type Tab = 'explore' | 'create' | 'dashboard' | 'my-forms'

export default function App() {
  const [tab, setTab] = useState<Tab>('explore')

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'explore' && <ExploreView />}
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
