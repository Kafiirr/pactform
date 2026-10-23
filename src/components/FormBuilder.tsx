import React, { useState } from 'react'
import { Plus, Trash2, ChevronDown, Save, ArrowLeft, AlertCircle, Loader2, Sparkles, ChevronUp, KeyRound, Lock } from 'lucide-react'
import { useAccount } from 'wagmi'
import type { PactForm, Question, QuestionType, PaymentMode } from '../types'
import { createForm, updateForm, generateFormWithAI, publishForm } from '../api'
import { useDeployFormContract } from '../hooks/useDeployFormContract'
import { PaymentRulesCard } from './PaymentRulesCard'
import { toast } from 'sonner'

interface FormBuilderProps {
  editing?: PactForm
  onSave: (form: PactForm) => void
  onCancel: () => void
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'yes_no', label: 'Yes / No' },
]

const newQuestion = (): Question => ({
  id: Math.random().toString(36).slice(2),
  type: 'short_text',
  label: '',
  required: false,
})

function RecipientRow({
  address,
  split,
  onAddress,
  onSplit,
  onRemove,
  canRemove,
}: {
  address: string
  split: number
  onAddress: (v: string) => void
  onSplit: (v: number) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={address}
        onChange={e => onAddress(e.target.value)}
        placeholder="0x... recipient address"
        className="flex-1 rounded-xl px-3 py-2 text-xs font-mono outline-none"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
      />
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={split / 100}
          onChange={e => onSplit(Math.round(parseFloat(e.target.value) * 100))}
          min={0}
          max={100}
          step={1}
          className="w-14 rounded-xl px-2 py-2 text-xs text-center outline-none"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>%</span>
      </div>
      {canRemove && (
        <button onClick={onRemove} className="p-1.5 rounded-lg hover:opacity-70 transition-opacity">
          <Trash2 className="size-3.5" style={{ color: 'var(--danger)' }} />
        </button>
      )}
    </div>
  )
}

export function FormBuilder({ editing, onSave, onCancel }: FormBuilderProps) {
  const { address } = useAccount()
  const { deploy: deployContractFromWallet } = useDeployFormContract()
  const paymentLocked = editing?.status === 'published' || editing?.status === 'archived'

  const [title, setTitle] = useState(editing?.title || '')
  const [description, setDescription] = useState(editing?.description || '')
  const [confirmationMessage, setConfirmationMessage] = useState(editing?.confirmation_message || 'Thank you for registering!')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(editing?.payment_mode || 'goal_escrow')
  const [priceUsdc, setPriceUsdc] = useState(editing?.price_usdc || '0.10')
  const [capacity, setCapacity] = useState(editing?.capacity || 0)
  const [goalCount, setGoalCount] = useState(editing?.goal_count || 3)
  const [deadlineDate, setDeadlineDate] = useState(() => {
    if (editing?.deadline_ts) {
      return new Date(editing.deadline_ts * 1000).toISOString().slice(0, 16)
    }
    const d = new Date(Date.now() + 7 * 86400 * 1000)
    return d.toISOString().slice(0, 16)
  })
  const [styleAccent, setStyleAccent] = useState(editing?.style_accent || '#b45309')

  // Recipients (up to 5)
  const [recipients, setRecipients] = useState<string[]>(
    editing?.recipients?.filter(r => r !== '0x0000000000000000000000000000000000000000') ||
    [address || '']
  )
  const [splits, setSplits] = useState<number[]>(
    editing?.splits?.filter((_, i) => editing?.recipients?.[i] !== '0x0000000000000000000000000000000000000000') ||
    [10000]
  )

  const [questions, setQuestions] = useState<Question[]>(editing?.questions || [
    { id: 'q1', type: 'short_text', label: 'Your full name', required: true },
    { id: 'q2', type: 'email', label: 'Email address', required: true },
  ])

  const [tab, setTab] = useState<'questions' | 'payment' | 'preview'>('questions')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // AI generation
  const [aiOpen, setAiOpen] = useState(!editing)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiKey, setAiKey] = useState(() => localStorage.getItem('pactform_or_key') || '')
  const [aiKeyVisible, setAiKeyVisible] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  const applyAiDraft = async () => {
    if (!aiPrompt.trim()) { toast.error('Enter a prompt first.'); return }
    setAiLoading(true)
    try {
      if (aiKey) localStorage.setItem('pactform_or_key', aiKey)
      const draft = await generateFormWithAI(aiPrompt.trim(), aiKey || undefined)

      setTitle(draft.title || '')
      setDescription(draft.description || '')
      setConfirmationMessage(draft.confirmation_message || 'Thank you for registering!')
      setPaymentMode(draft.payment_mode || 'collect_split')
      setPriceUsdc(draft.price_usdc || '1.00')
      setGoalCount(draft.goal_count || 3)
      setCapacity(draft.capacity || 0)
      setStyleAccent(draft.style_accent || '#b45309')
      if (Array.isArray(draft.questions) && draft.questions.length > 0) {
        setQuestions(draft.questions.map((q, i) => ({
          ...q,
          id: q.id || `q${i + 1}`,
        })))
      }
      if (draft.deadline_ts && draft.deadline_ts > 0) {
        setDeadlineDate(new Date(draft.deadline_ts * 1000).toISOString().slice(0, 16))
      }
      // If splits_equal or single recipient keep existing recipient with 100%
      if (draft.splits_equal && recipients.length === 1) {
        setSplits([10000])
      }
      setAiOpen(false)
      setTab('questions')
      toast.success('Form generated! Review and adjust before saving.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAiLoading(false)
    }
  }

  const splitSum = splits.reduce((a, b) => a + b, 0)

  const validate = (): string[] => {
    const errs: string[] = []
    if (!title.trim()) errs.push('Form title is required.')
    if (paymentMode !== 'free') {
      if (!priceUsdc || parseFloat(priceUsdc) <= 0) errs.push('Price must be greater than 0.')
      if (recipients.length === 0) errs.push('At least one recipient is required.')
      if (splitSum !== 10000) errs.push(`Splits must total 100%. Currently ${(splitSum / 100).toFixed(0)}%.`)
      for (const r of recipients) {
        if (!r.match(/^0x[0-9a-fA-F]{40}$/)) errs.push(`Invalid recipient address: ${r}`)
      }
    }
    if (paymentMode === 'goal_escrow') {
      if (goalCount < 1) errs.push('Goal count must be at least 1.')
      if (!deadlineDate) errs.push('Deadline is required for Goal Escrow.')
    }
    return errs
  }

  const handleSave = async () => {
    const errs = validate()
    if (errs.length) { setErrors(errs); return }
    setErrors([])

    if (!address) { toast.error('Connect your wallet first.'); return }

    const deadlineTs = paymentMode === 'goal_escrow' && deadlineDate
      ? Math.floor(new Date(deadlineDate).getTime() / 1000)
      : 0

    // Pad recipients/splits to 5 slots
    const paddedRecipients = [...recipients]
    const paddedSplits = [...splits]
    while (paddedRecipients.length < 5) {
      paddedRecipients.push('0x0000000000000000000000000000000000000000')
      paddedSplits.push(0)
    }

    const payload: Partial<PactForm> = {
      creator_address: address,
      title,
      description,
      confirmation_message: confirmationMessage,
      payment_mode: paymentMode,
      price_usdc: priceUsdc,
      capacity,
      goal_count: goalCount,
      deadline_ts: deadlineTs,
      recipients: paddedRecipients,
      splits: paddedSplits,
      questions,
      style_accent: styleAccent,
    }

    setSaving(true)
    try {
      const saved = editing
        ? await updateForm(editing.id, payload)
        : await createForm(payload)
      toast.success('Form saved as draft.')
      onSave(saved)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndPublish = async () => {
    const errs = validate()
    if (errs.length) { setErrors(errs); return }
    setErrors([])
    if (!address) { toast.error('Connect your wallet first.'); return }

    const deadlineTs = paymentMode === 'goal_escrow' && deadlineDate
      ? Math.floor(new Date(deadlineDate).getTime() / 1000)
      : 0

    const paddedRecipients = [...recipients]
    const paddedSplits = [...splits]
    while (paddedRecipients.length < 5) {
      paddedRecipients.push('0x0000000000000000000000000000000000000000')
      paddedSplits.push(0)
    }

    const payload: Partial<PactForm> = {
      creator_address: address,
      title, description, confirmation_message: confirmationMessage,
      payment_mode: paymentMode, price_usdc: priceUsdc,
      capacity, goal_count: goalCount, deadline_ts: deadlineTs,
      recipients: paddedRecipients, splits: paddedSplits,
      questions, style_accent: styleAccent,
    }

    setPublishing(true)
    try {
      const saved = editing
        ? await updateForm(editing.id, payload)
        : await createForm(payload)
      if (paymentMode === 'free') {
        await publishForm(saved.id, '0x0000000000000000000000000000000000000000', 5042)
        toast.success('Published! Your form is now live.')
        onSave({ ...saved, status: 'published' })
      } else {
        toast.info('Confirm the contract deployment in your wallet...')
        const contractAddress = await deployContractFromWallet(saved)
        await publishForm(saved.id, contractAddress, 5042)
        toast.success('Published! Your form is now live.')
        onSave({ ...saved, status: 'published', contract_address: contractAddress })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  const addRecipient = () => {
    if (recipients.length >= 5) return
    setRecipients([...recipients, ''])
    // Redistribute evenly
    const newCount = recipients.length + 1
    const even = Math.floor(10000 / newCount)
    const remainder = 10000 - even * newCount
    setSplits(Array.from({ length: newCount }, (_, i) => i === newCount - 1 ? even + remainder : even))
  }

  const removeRecipient = (i: number) => {
    const nr = recipients.filter((_, j) => j !== i)
    const ns = splits.filter((_, j) => j !== i)
    // Redistribute remaining splits
    const total = ns.reduce((a, b) => a + b, 0)
    if (total === 0 && nr.length > 0) {
      const even = Math.floor(10000 / nr.length)
      const rem = 10000 - even * nr.length
      setRecipients(nr)
      setSplits(nr.map((_, j) => j === nr.length - 1 ? even + rem : even))
    } else {
      setRecipients(nr)
      setSplits(ns)
    }
  }

  // Build preview form
  const previewForm: PactForm = {
    id: editing?.id || 'preview',
    creator_address: address || '',
    title: title || 'Untitled form',
    description: description || '',
    confirmation_message: confirmationMessage,
    payment_mode: paymentMode,
    price_usdc: priceUsdc || '0',
    capacity,
    goal_count: goalCount,
    deadline_ts: deadlineDate ? Math.floor(new Date(deadlineDate).getTime() / 1000) : 0,
    recipients: recipients.concat(Array(5 - recipients.length).fill('0x0000000000000000000000000000000000000000')),
    splits: splits.concat(Array(5 - splits.length).fill(0)),
    questions,
    status: 'draft',
    contract_address: null,
    chain_id: null,
    version: 1,
    created_at: 0,
    published_at: null,
    style_accent: styleAccent,
  }

  const tabs = [
    { id: 'questions' as const, label: 'Questions' },
    { id: 'payment' as const, label: 'Payment' },
    { id: 'preview' as const, label: 'Preview' },
  ]

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onCancel} className="hover:opacity-60 transition-opacity">
          <ArrowLeft className="size-5" style={{ color: 'var(--muted)' }} />
        </button>
        <h1 className="display text-xl font-600" style={{ color: 'var(--ink)' }}>
          {editing ? 'Edit form' : 'New form'}
        </h1>
      </div>

      {/* ── AI Generate panel ── */}
      <div
        className="rounded-2xl mb-4 overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <button
          onClick={() => setAiOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <Sparkles className="size-4" style={{ color: 'var(--accent)' }} />
            Generate with AI
          </span>
          {aiOpen
            ? <ChevronUp className="size-4" style={{ color: 'var(--muted)' }} />
            : <ChevronDown className="size-4" style={{ color: 'var(--muted)' }} />}
        </button>

        {aiOpen && (
          <div className="px-5 pb-5 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-xs pt-3" style={{ color: 'var(--muted)' }}>
              Describe your form and the AI will generate questions, payment mode, price, and settings.
            </p>

            {/* API key (BYOK) */}
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <KeyRound className="size-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
              <input
                type={aiKeyVisible ? 'text' : 'password'}
                value={aiKey}
                onChange={e => setAiKey(e.target.value)}
                placeholder="OpenRouter API key (sk-or-…)"
                className="flex-1 text-xs bg-transparent outline-none font-mono"
                style={{ color: 'var(--ink)' }}
              />
              <button
                onClick={() => setAiKeyVisible(v => !v)}
                className="text-xs shrink-0"
                style={{ color: 'var(--muted)' }}
              >
                {aiKeyVisible ? 'hide' : 'show'}
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Your key is stored only in this browser and sent directly to your backend — never to a third party.{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Get a key →</a>
            </p>

            {/* Prompt */}
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder='e.g. "Generate a form for a Bug Bounty Program with $200 USDC prize pool" or "Create a paid workshop registration for a Solidity bootcamp"'
              rows={3}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { void applyAiDraft() } }}
              className="w-full text-sm rounded-xl px-3 py-2.5 outline-none resize-none"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            />

            <button
              onClick={() => { void applyAiDraft() }}
              disabled={aiLoading || !aiPrompt.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
              style={{ background: 'var(--accent)' }}
            >
              {aiLoading
                ? <><Loader2 className="size-4 animate-spin" /> Generating…</>
                : <><Sparkles className="size-4" /> Generate form</>}
            </button>
          </div>
        )}
      </div>

      {/* Title / description */}
      <div
        className="rounded-2xl p-5 mb-4 space-y-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Form title..."
          className="w-full display text-2xl font-600 bg-transparent outline-none placeholder:opacity-30"
          style={{ color: 'var(--ink)' }}
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Short description visible to respondents..."
          rows={2}
          className="w-full text-sm bg-transparent outline-none resize-none placeholder:opacity-40"
          style={{ color: 'var(--muted)' }}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--muted)' }}>Accent</label>
          <input
            type="color"
            value={styleAccent}
            onChange={e => setStyleAccent(e.target.value)}
            className="size-6 rounded cursor-pointer border-0 outline-none"
          />
          <div className="h-1.5 flex-1 rounded-full" style={{ background: styleAccent }} />
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl mb-4"
        style={{ background: 'var(--surface-muted)' }}
      >
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: tab === t.id ? 'white' : 'transparent',
              color: tab === t.id ? 'var(--ink)' : 'var(--muted)',
              boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Questions tab */}
      {tab === 'questions' && (
        <div className="space-y-3">
          {questions.map((q, qi) => (
            <div
              key={q.id}
              className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    value={q.label}
                    onChange={e => setQuestions(qs => qs.map((item, i) => i === qi ? { ...item, label: e.target.value } : item))}
                    placeholder="Question text..."
                    className="w-full text-sm font-medium bg-transparent outline-none placeholder:opacity-40"
                    style={{ color: 'var(--ink)' }}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={q.type}
                      onChange={e => setQuestions(qs => qs.map((item, i) => i === qi ? { ...item, type: e.target.value as QuestionType } : item))}
                      className="text-xs rounded-lg px-2 py-1 outline-none"
                      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                    >
                      {QUESTION_TYPES.map(qt => (
                        <option key={qt.value} value={qt.value}>{qt.label}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={e => setQuestions(qs => qs.map((item, i) => i === qi ? { ...item, required: e.target.checked } : item))}
                        className="rounded"
                      />
                      Required
                    </label>
                  </div>

                  {/* Options for choice questions */}
                  {(q.type === 'single_choice' || q.type === 'multiple_choice') && (
                    <div className="space-y-1.5 mt-2">
                      {(q.options || []).map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt}
                            onChange={e => setQuestions(qs => qs.map((item, i) =>
                              i === qi ? {
                                ...item,
                                options: item.options?.map((o, j) => j === oi ? e.target.value : o)
                              } : item
                            ))}
                            placeholder={`Option ${oi + 1}`}
                            className="flex-1 text-xs rounded-lg px-2 py-1.5 outline-none"
                            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                          />
                          <button onClick={() => setQuestions(qs => qs.map((item, i) =>
                            i === qi ? { ...item, options: item.options?.filter((_, j) => j !== oi) } : item
                          ))}>
                            <Trash2 className="size-3" style={{ color: 'var(--danger)' }} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setQuestions(qs => qs.map((item, i) =>
                          i === qi ? { ...item, options: [...(item.options || []), ''] } : item
                        ))}
                        className="text-xs flex items-center gap-1 mt-1"
                        style={{ color: 'var(--accent)' }}
                      >
                        <Plus className="size-3" /> Add option
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setQuestions(qs => qs.filter((_, i) => i !== qi))}
                  className="p-1.5 rounded-lg hover:opacity-70 transition-opacity mt-0.5"
                >
                  <Trash2 className="size-4" style={{ color: 'var(--danger)' }} />
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={() => setQuestions([...questions, newQuestion()])}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium border-2 border-dashed transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--muted)' }}
          >
            <Plus className="size-4" /> Add question
          </button>
        </div>
      )}

      {/* Payment tab */}
      {tab === 'payment' && (
        <div className="space-y-4">
          {paymentLocked && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-2 text-sm"
              style={{ background: 'rgba(180,83,9,0.07)', border: '1px solid rgba(180,83,9,0.2)', color: 'var(--accent)' }}>
              <Lock size={15} className="mt-0.5 shrink-0" />
              <span>Payment settings are locked — they are baked into the deployed contract and cannot be changed. You can still edit questions, title, description, and confirmation message.</span>
            </div>
          )}
          {/* Mode */}
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: paymentLocked ? 0.6 : 1 }}
          >
            <label className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Payment mode</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'goal_escrow', label: 'Goal Escrow', desc: 'Held until goal met' },
                { value: 'collect_split', label: 'Collect & Split', desc: 'Paid out immediately' },
                { value: 'free', label: 'Free', desc: 'No payment required' },
              ] as const).map(m => (
                <button
                  key={m.value}
                  onClick={() => !paymentLocked && setPaymentMode(m.value)}
                  disabled={paymentLocked}
                  className="p-3 rounded-xl text-left transition-all"
                  style={{
                    background: paymentMode === m.value ? 'rgba(180,83,9,0.08)' : 'var(--surface-muted)',
                    border: '2px solid',
                    borderColor: paymentMode === m.value ? 'var(--accent)' : 'var(--border)',
                    cursor: paymentLocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{m.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Price — hidden for free forms */}
          {paymentMode !== 'free' && <div
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: paymentLocked ? 0.6 : 1 }}
          >
            <label className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Registration price</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={priceUsdc}
                onChange={e => setPriceUsdc(e.target.value)}
                step="any"
                min="0.000001"
                disabled={paymentLocked}
                className="w-32 rounded-xl px-3 py-2 text-lg font-bold outline-none tabular-nums"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              />
              <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
            </div>
          </div>}

          {/* Goal & deadline (escrow only) */}
          {paymentMode === 'goal_escrow' && (
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: paymentLocked ? 0.6 : 1 }}
            >
              <label className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Escrow settings</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--muted)' }}>Goal (paid registrations)</label>
                  <input
                    type="number"
                    value={goalCount}
                    onChange={e => setGoalCount(parseInt(e.target.value) || 0)}
                    min={1}
                    disabled={paymentLocked}
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--muted)' }}>Capacity (0 = unlimited)</label>
                  <input
                    type="number"
                    value={capacity}
                    onChange={e => setCapacity(parseInt(e.target.value) || 0)}
                    min={0}
                    disabled={paymentLocked}
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--muted)' }}>Deadline</label>
                <input
                  type="datetime-local"
                  value={deadlineDate}
                  onChange={e => setDeadlineDate(e.target.value)}
                  disabled={paymentLocked}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                />
              </div>
            </div>
          )}

          {/* Recipients — hidden for free forms */}
          {paymentMode !== 'free' && <div
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: paymentLocked ? 0.6 : 1 }}
          >
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Recipients</label>
              <span
                className="text-xs font-medium"
                style={{ color: splitSum === 10000 ? 'var(--success)' : 'var(--danger)' }}
              >
                {(splitSum / 100).toFixed(0)}% of 100%
              </span>
            </div>
            <div className="space-y-2">
              {recipients.map((r, i) => (
                <RecipientRow
                  key={i}
                  address={r}
                  split={splits[i] || 0}
                  onAddress={v => !paymentLocked && setRecipients(rs => rs.map((x, j) => j === i ? v : x))}
                  onSplit={v => !paymentLocked && setSplits(ss => ss.map((x, j) => j === i ? v : x))}
                  onRemove={() => !paymentLocked && removeRecipient(i)}
                  canRemove={!paymentLocked && recipients.length > 1}
                />
              ))}
            </div>
            {!paymentLocked && recipients.length < 5 && (
              <button
                onClick={addRecipient}
                className="flex items-center gap-1.5 text-xs font-medium"
                style={{ color: 'var(--accent)' }}
              >
                <Plus className="size-3.5" /> Add recipient
              </button>
            )}
          </div>}

          {/* Confirmation message */}
          <div
            className="rounded-2xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <label className="text-sm font-semibold block mb-2" style={{ color: 'var(--ink)' }}>
              Confirmation message
            </label>
            <textarea
              value={confirmationMessage}
              onChange={e => setConfirmationMessage(e.target.value)}
              rows={2}
              placeholder="Message shown after successful registration..."
              className="w-full text-sm bg-transparent outline-none resize-none placeholder:opacity-40"
              style={{ color: 'var(--ink)' }}
            />
          </div>
        </div>
      )}

      {/* Preview tab */}
      {tab === 'preview' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            This is how your payment terms card will appear to respondents.
          </p>
          <PaymentRulesCard form={previewForm} />
          <div
            className="rounded-2xl p-4 text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
          >
            <strong>Questions ({questions.length}):</strong>
            <ul className="mt-2 space-y-1 list-disc list-inside text-xs" style={{ color: 'var(--muted)' }}>
              {questions.map(q => (
                <li key={q.id}>{q.label || '(untitled)'}{q.required ? <span style={{ color: 'var(--accent)' }}> *</span> : ''}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div
          className="mt-4 rounded-xl p-3 space-y-1"
          style={{ background: 'rgba(190,18,60,0.08)', border: '1px solid rgba(190,18,60,0.2)' }}
        >
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--danger)' }}>
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" /> {e}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-3 rounded-2xl text-sm font-medium shrink-0"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
        >
          Cancel
        </button>
        {paymentLocked ? (
          <button
            onClick={() => { void handleSave() }}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        ) : (<>
          <button
            onClick={() => { void handleSave() }}
            disabled={saving || publishing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={() => { void handleSaveAndPublish() }}
            disabled={saving || publishing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {publishing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {publishing ? 'Publishing…' : 'Save & Publish'}
          </button>
        </>)}
      </div>
      {publishing && (
        <p className="mt-2 text-center text-xs" style={{ color: 'var(--muted)' }}>
          Deploying contract to Arc Testnet — this takes ~15s…
        </p>
      )}
    </div>
  )
}
