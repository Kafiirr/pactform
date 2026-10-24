import React, { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Loader2, ExternalLink, Copy, Check, Users, Download, Send, Trash2, Archive, ArchiveRestore, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { PactForm, Submission } from '../types'
import { getCreatorForms, getFormResponses, publishForm, deleteForm, archiveForm, unarchiveForm } from '../api'
import { useDeployFormContract } from '../hooks/useDeployFormContract'
import { FormBuilder } from './FormBuilder'
import { formatUsdc, formatDeadline, copyToClipboard, formatAddress } from '../utils'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, ESCROW_ABI, COLLECT_SPLIT_ABI } from '../contracts'
import { parseOnchainError, isUserRejection } from '../utils'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stringifyAnswer(x: unknown): string {
  if (x == null) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'number' || typeof x === 'boolean') return x.toString()
  return JSON.stringify(x)
}

// ---------------------------------------------------------------------------
// Response card with expandable answers
// ---------------------------------------------------------------------------
function ResponseCard({ response, index, questions }: {
  response: Submission
  index: number
  questions: import('../types').Question[]
}) {
  const [expanded, setExpanded] = useState(false)
  const answers = response.response_data ?? {}
  const hasAnswers = Object.keys(answers).length > 0

  return (
    <div
      className=" overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Header row */}
      <button
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
        onClick={() => hasAnswers && setExpanded(e => !e)}
        style={{ cursor: hasAnswers ? 'pointer' : 'default' }}
      >
        <span
          className="size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
        >
          {index}
        </span>
        <div className="flex-1 min-w-0">
          <p className="mono text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>
            {response.payer_address.startsWith('anon_') ? 'Anonymous' : response.payer_address}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {response.created_at ? new Date(response.created_at * 1000).toLocaleString() : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              background: response.status === 'confirmed' ? 'rgba(21,128,61,0.10)' : 'rgba(180,83,9,0.10)',
              color: response.status === 'confirmed' ? 'var(--success)' : 'var(--accent)',
            }}
          >
            {response.status}
          </span>
          {response.tx_hash && (
            <a
              href={buildTxExplorerUrl(CHAIN_ID, response.tx_hash)}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink className="size-3.5" style={{ color: 'var(--subtle)' }} />
            </a>
          )}
          {hasAnswers && (
            expanded
              ? <ChevronUp className="size-4" style={{ color: 'var(--muted)' }} />
              : <ChevronDown className="size-4" style={{ color: 'var(--muted)' }} />
          )}
        </div>
      </button>

      {/* Answers panel */}
      {expanded && hasAnswers && (
        <div
          className="px-4 pb-4 pt-1 space-y-3 border-t overflow-hidden"
          style={{ borderColor: 'var(--border)' }}
        >
          {questions.length > 0
            ? questions.map(q => {
                const raw = answers[q.id]
                if (raw === undefined || raw === null || raw === '') return null
                const value = Array.isArray(raw) ? raw.map(stringifyAnswer).join(', ') : stringifyAnswer(raw)
                return (
                  <div key={q.id}>
                    <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>{q.label}</p>
                    <p className="text-sm rounded-lg px-3 py-2 break-words whitespace-pre-wrap" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
                      {value}
                    </p>
                  </div>
                )
              })
            : Object.entries(answers).map(([k, v]) => {
                const display = Array.isArray(v) ? v.map(stringifyAnswer).join(', ') : stringifyAnswer(v)
                return (
                  <div key={k}>
                    <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>{k}</p>
                    <p className="text-sm rounded-lg px-3 py-2 break-words whitespace-pre-wrap" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
                      {display}
                    </p>
                  </div>
                )
              })
          }
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-form onchain actions for creator
// ---------------------------------------------------------------------------
function CreatorFormActions({ form, wrongChain, onSwitchChain }: {
  form: PactForm
  wrongChain: boolean
  onSwitchChain: () => void
}) {
  const { address } = useAccount()
  const contractAddr = form.contract_address as `0x${string}` | undefined
  const isEscrow = form.payment_mode === 'goal_escrow'

  const { data: finalized, refetch: refetchFinalized } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'finalized',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: escrowStatus, refetch: refetchStatus } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'status',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: registrationCount } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'registrationCount',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: deadline } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'deadline',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: capacity } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'capacity',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  // Creator withdrawable (escrow GoalReached or collect & split)
  const { data: withdrawableEscrow, refetch: refetchWE } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'withdrawable',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr && !!address },
  })
  const { data: withdrawableCS, refetch: refetchWCS } = useReadContract({
    address: contractAddr,
    abi: COLLECT_SPLIT_ABI as never,
    functionName: 'withdrawable',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !isEscrow && !!contractAddr && !!address },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash, chainId: CHAIN_ID })

  useEffect(() => {
    if (isSuccess) {
      toast.success('Transaction confirmed!')
      void refetchFinalized(); void refetchStatus(); void refetchWE(); void refetchWCS()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const isBusy = isPending || isConfirming

  const deadlineTs = typeof deadline === 'bigint' ? Number(deadline) : Number(deadline ?? form.deadline_ts ?? 0)
  const nowTs = Math.floor(Date.now() / 1000)
  const deadlinePassed = deadlineTs > 0 && nowTs >= deadlineTs
  const regsNum = Number(registrationCount ?? 0)
  const goalNum = form.goal_count ?? 0
  const capNum = Number(capacity ?? 0)
  const goalMet = regsNum >= goalNum && goalNum > 0
  const statusNum = typeof escrowStatus === 'number' ? escrowStatus : Number(escrowStatus ?? 0)
  // Contract finalize() requires: deadline passed OR capacity filled (goal alone is not enough)
  const capacityFilled = capNum > 0 && regsNum >= capNum
  const canFinalize = isEscrow && !finalized && (deadlinePassed || capacityFilled)
  const canWithdrawEscrow = isEscrow && statusNum === 1 && BigInt((withdrawableEscrow as bigint | undefined) ?? 0n) > 0n
  const canWithdrawCS = !isEscrow && BigInt((withdrawableCS as bigint | undefined) ?? 0n) > 0n

  const doWrite = (fn: string, abi: readonly unknown[], args: unknown[] = []) => {
    if (!contractAddr) return
    if (wrongChain) { onSwitchChain(); return }
    try {
      writeContract({ address: contractAddr, abi: abi as never, functionName: fn, args, chainId: CHAIN_ID })
    } catch (e) { if (!isUserRejection(e)) toast.error(parseOnchainError(e)) }
  }

  if (!contractAddr) return null
  // Show the section if there's anything actionable OR if we want to show a pending status
  const showPendingGoalMsg = isEscrow && !finalized && goalMet && !canFinalize
  if (!canFinalize && !canWithdrawEscrow && !canWithdrawCS && !showPendingGoalMsg) return null

  return (
    <div className="flex flex-wrap gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
      {/* Goal met but deadline hasn't passed — can't finalize yet */}
      {showPendingGoalMsg && (
        <p className="w-full text-xs" style={{ color: 'var(--muted)' }}>
          Goal reached ({regsNum}/{goalNum}). Finalize unlocks after the deadline passes.
        </p>
      )}
      {canFinalize && (
        <button
          onClick={() => doWrite('finalize', ESCROW_ABI)}
          disabled={isBusy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
          style={{ background: goalMet ? '#15803d' : 'var(--accent)' }}
        >
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isBusy ? 'Processing…' : goalMet ? 'Finalize (goal reached)' : 'Finalize (deadline passed — goal missed)'}
        </button>
      )}
      {canWithdrawEscrow && (
        <button
          onClick={() => doWrite('withdraw', ESCROW_ABI)}
          disabled={isBusy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
          style={{ background: '#15803d' }}
        >
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isBusy ? 'Processing…' : 'Withdraw your share'}
        </button>
      )}
      {canWithdrawCS && (
        <button
          onClick={() => doWrite('withdraw', COLLECT_SPLIT_ABI)}
          disabled={isBusy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}
        >
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isBusy ? 'Processing…' : `Withdraw USDC`}
        </button>
      )}
    </div>
  )
}

type CreatorTab = 'list' | 'build' | 'responses'

export function CreatorDashboard() {
  const { address, isConnected, chainId: walletChainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { deploy: deployContract } = useDeployFormContract()
  const [tab, setTab] = useState<CreatorTab>('list')
  const [forms, setForms] = useState<PactForm[]>([])
  const [loading, setLoading] = useState(false)
  const [editingForm, setEditingForm] = useState<PactForm | undefined>()
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [responses, setResponses] = useState<Submission[]>([])
  const [responsesLoading, setResponsesLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // Confirm modal: { formId, action, label, description }
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<{
    formId: string; action: 'delete' | 'archive' | 'unarchive'; label: string; description: string
  } | null>(null)

  const load = async () => {
    if (!address) return
    setLoading(true)
    try {
      const data = await getCreatorForms(address)
      setForms(data)
    } catch { } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isConnected && address) void load()
    // load is stable (not memoized) — intentional omission to avoid infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected])

  const loadResponses = async (formId: string) => {
    setResponsesLoading(true)
    try {
      const data = await getFormResponses(formId)
      setResponses(data)
    } catch { } finally {
      setResponsesLoading(false)
    }
  }

  const handleViewResponses = (form: PactForm) => {
    setSelectedFormId(form.id)
    setTab('responses')
    void loadResponses(form.id)
  }

  const handlePublish = async (form: PactForm) => {
    if (!address) { toast.error('Connect your wallet first.'); return }
    setPublishing(form.id)
    try {
      let contractAddress: string
      if (form.payment_mode === 'free') {
        contractAddress = '0x0000000000000000000000000000000000000000'
      } else {
        toast.info('Deploying contract — confirm in your wallet...')
        contractAddress = await deployContract(form)
      }
      await publishForm(form.id, contractAddress, 5042)
      toast.success('Form published! Share the link with your respondents.')
      void load()
    } catch (e) {
      if (!isUserRejection(e)) toast.error(parseOnchainError(e))
    } finally {
      setPublishing(null)
    }
  }

  const handleCopyLink = async (form: PactForm) => {
    const url = `${window.location.origin}?form=${form.id}`
    await copyToClipboard(url)
    setCopied(form.id)
    setTimeout(() => setCopied(null), 2000)
    toast.success('Link copied!')
  }

  const handleConfirmAction = async () => {
    if (!confirmModal) return
    const { formId, action } = confirmModal
    setConfirmModal(null)
    setActionLoading(formId)
    try {
      if (action === 'delete') await deleteForm(formId)
      else if (action === 'archive') await archiveForm(formId)
      else if (action === 'unarchive') await unarchiveForm(formId)
      toast.success(action === 'delete' ? 'Form deleted.' : action === 'archive' ? 'Form archived.' : 'Form restored.')
      void load()
    } catch (e) {
      if (!isUserRejection(e)) toast.error(parseOnchainError(e))
    } finally {
      setActionLoading(null)
    }
  }

  const exportCsv = (form: PactForm) => {
    const rows = responses.map(r => [
      r.id.slice(0, 12),
      formatAddress(r.payer_address),
      r.status,
      r.tx_hash ? r.tx_hash.slice(0, 16) + '...' : '',
      r.created_at ? new Date(r.created_at * 1000).toISOString() : '',
    ])
    const csv = [['ID', 'Payer', 'Status', 'Tx Hash', 'Created At'], ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${form.title.replace(/\s+/g, '-')}-responses.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const wrongChain = isConnected && walletChainId !== CHAIN_ID

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 px-4">
        <p className="text-lg font-medium" style={{ color: 'var(--ink)' }}>Connect your wallet to manage forms.</p>
        <ConnectKitButton />
      </div>
    )
  }

  if (tab === 'build') {
    return (
      <FormBuilder
        editing={editingForm}
        onSave={(_saved) => { setTab('list'); void load() }}
        onCancel={() => setTab('list')}
      />
    )
  }

  if (tab === 'responses' && selectedFormId) {
    const form = forms.find(f => f.id === selectedFormId)
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <button
          onClick={() => setTab('list')}
          className="flex items-center gap-2 text-sm mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--muted)' }}
        >
          ← Back to forms
        </button>

        <div className="flex items-center justify-between mb-4">
          <h2 className="display text-xl font-600" style={{ color: 'var(--ink)' }}>
            Responses — {form?.title}
          </h2>
          {responses.length > 0 && (
            <button
              onClick={() => form && exportCsv(form)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
            >
              <Download className="size-3.5" /> Export CSV
            </button>
          )}
        </div>

        {responsesLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : responses.length === 0 ? (
          <div className="text-center py-12 " style={{ background: 'var(--surface-muted)' }}>
            <Users className="size-8 mx-auto mb-2" style={{ color: 'var(--subtle)' }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No responses yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {responses.map((r, idx) => (
              <ResponseCard
                key={r.id}
                response={r}
                index={idx + 1}
                questions={form?.questions ?? []}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Forms list
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="display text-2xl font-600" style={{ color: 'var(--ink)' }}>My Forms</h2>
        <button
          onClick={() => { setEditingForm(undefined); setTab('build') }}
          className="flex items-center gap-2 px-4 py-2.5  text-sm font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          <span className="text-lg leading-none">+</span> New form
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : forms.length === 0 ? (
        <div className="text-center py-16 " style={{ background: 'var(--surface-muted)' }}>
          <p className="text-lg font-medium mb-2" style={{ color: 'var(--ink)' }}>No forms yet</p>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>Create your first funded form.</p>
          <button
            onClick={() => { setEditingForm(undefined); setTab('build') }}
            className="px-5 py-2.5  text-sm font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            Create form
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active forms: drafts + published */}
          <div className="space-y-3">
            {forms.filter(f => f.status !== 'archived').length === 0 && (
              <div className="text-center py-10 " style={{ background: 'var(--surface-muted)' }}>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>No active forms. Create one above.</p>
              </div>
            )}
            {forms.filter(f => f.status !== 'archived').map(form => (
            <div
              key={form.id}
              className=" p-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="display text-base font-600 truncate" style={{ color: 'var(--ink)' }}>
                      {form.title}
                    </h3>
                    <span
                      className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: form.status === 'published' ? 'rgba(21,128,61,0.10)' : form.status === 'archived' ? 'rgba(180,83,9,0.08)' : 'var(--surface-muted)',
                        color: form.status === 'published' ? 'var(--success)' : form.status === 'archived' ? 'var(--accent)' : 'var(--muted)',
                      }}
                    >
                      {form.status}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {formatUsdc(form.price_usdc)} USDC · {form.payment_mode === 'goal_escrow' ? 'Goal Escrow' : 'Collect & Split'}
                    {form.deadline_ts > 0 ? ` · Due ${formatDeadline(form.deadline_ts)}` : ''}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {form.status === 'draft' && (
                  <>
                    <button
                      onClick={() => { setEditingForm(form); setTab('build') }}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { void handlePublish(form) }}
                      disabled={publishing === form.id || actionLoading === form.id}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
                      style={{ background: 'var(--accent)' }}
                    >
                      {publishing === form.id
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Send className="size-3.5" />}
                      {publishing === form.id ? 'Publishing…' : 'Publish'}
                    </button>
                    <button
                      onClick={() => setConfirmModal({
                        formId: form.id,
                        action: 'delete',
                        label: 'Delete form',
                        description: `"${form.title}" will be permanently deleted. This cannot be undone.`,
                      })}
                      disabled={actionLoading === form.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)' }}
                    >
                      {actionLoading === form.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      Delete
                    </button>
                  </>
                )}
                {form.status === 'published' && (
                  <>
                    <button
                      onClick={() => { void handleCopyLink(form) }}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
                    >
                      {copied === form.id ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                      {copied === form.id ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      onClick={() => handleViewResponses(form)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
                    >
                      <Users className="size-3.5" /> Responses
                    </button>
                    <button
                      onClick={() => setConfirmModal({
                        formId: form.id,
                        action: 'archive',
                        label: 'Archive form',
                        description: `"${form.title}" will be hidden from the Explore page. Existing registrations are preserved. You can restore it at any time.`,
                      })}
                      disabled={actionLoading === form.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                    >
                      {actionLoading === form.id ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                      Archive
                    </button>
                    <button
                      onClick={() => setConfirmModal({
                        formId: form.id,
                        action: 'delete',
                        label: 'Delete form',
                        description: `"${form.title}" and all its submission records will be permanently deleted. This cannot be undone. Note: the deployed contract remains onchain.`,
                      })}
                      disabled={actionLoading === form.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)' }}
                    >
                      {actionLoading === form.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      Delete
                    </button>
                  </>
                )}
                {form.status === 'archived' && (
                  <>
                    <button
                      onClick={() => handleViewResponses(form)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
                    >
                      <Users className="size-3.5" /> Responses
                    </button>
                    <button
                      onClick={() => setConfirmModal({
                        formId: form.id,
                        action: 'unarchive',
                        label: 'Restore form',
                        description: `"${form.title}" will be visible on the Explore page again.`,
                      })}
                      disabled={actionLoading === form.id}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60"
                      style={{ background: '#15803d' }}
                    >
                      {actionLoading === form.id ? <Loader2 className="size-3.5 animate-spin" /> : <ArchiveRestore className="size-3.5" />}
                      Restore
                    </button>
                    <button
                      onClick={() => setConfirmModal({
                        formId: form.id,
                        action: 'delete',
                        label: 'Delete form',
                        description: `"${form.title}" and all its submission records will be permanently deleted. This cannot be undone. Note: the deployed contract remains onchain.`,
                      })}
                      disabled={actionLoading === form.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)' }}
                    >
                      {actionLoading === form.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      Delete
                    </button>
                  </>
                )}
                {form.contract_address && (
                  <a
                    href={`https://explorer.arc.io/address/${form.contract_address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                  >
                    <ExternalLink className="size-3.5" /> Contract
                  </a>
                )}
              </div>

              {/* Onchain actions: finalize / withdraw (reads live contract state) */}
              {form.status === 'published' && (
                <CreatorFormActions
                  form={form}
                  wrongChain={wrongChain}
                  onSwitchChain={() => switchChain({ chainId: CHAIN_ID })}
                />
              )}
            </div>
          ))}
          </div>

          {/* Archived section */}
          {forms.some(f => f.status === 'archived') && (
            <div>
              <button
                onClick={() => setArchivedOpen(o => !o)}
                className="flex items-center gap-2 text-sm font-semibold mb-3 w-full text-left"
                style={{ color: 'var(--muted)' }}
              >
                <Archive className="size-4" />
                Archived ({forms.filter(f => f.status === 'archived').length})
                <span className="ml-auto text-xs">{archivedOpen ? '▲ hide' : '▼ show'}</span>
              </button>
              {archivedOpen && (
                <div className="space-y-3">
                  {forms.filter(f => f.status === 'archived').map(form => (
                    <div
                      key={form.id}
                      className=" p-4 opacity-70"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="display text-base font-600 truncate" style={{ color: 'var(--ink)' }}>{form.title}</h3>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                            {formatUsdc(form.price_usdc)} USDC · {form.payment_mode === 'goal_escrow' ? 'Goal Escrow' : 'Collect & Split'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button
                          onClick={() => setConfirmModal({ formId: form.id, action: 'unarchive', label: 'Restore form?', description: 'This will make the form visible on Explore again.' })}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                          style={{ background: 'rgba(21,128,61,0.10)', color: 'var(--success)' }}
                        >
                          <ArchiveRestore className="size-3.5" /> Restore
                        </button>
                        <button
                          onClick={() => setConfirmModal({ formId: form.id, action: 'delete', label: 'Delete form?', description: 'This permanently removes the form and all submission records.' })}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                          style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)' }}
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Confirm modal ── */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(26,18,9,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="w-full max-w-sm  p-6"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(26,18,9,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div
                className="shrink-0 w-9 h-9  flex items-center justify-center"
                style={{ background: confirmModal.action === 'delete' ? 'rgba(190,18,60,0.10)' : 'rgba(180,83,9,0.10)' }}
              >
                <AlertTriangle
                  className="size-4"
                  style={{ color: confirmModal.action === 'delete' ? 'var(--danger)' : 'var(--accent)' }}
                />
              </div>
              <div>
                <h3 className="display font-600 text-base mb-1" style={{ color: 'var(--ink)' }}>{confirmModal.label}</h3>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>{confirmModal.description}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2  text-sm font-medium"
                style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleConfirmAction() }}
                className="px-4 py-2  text-sm font-semibold text-white"
                style={{ background: confirmModal.action === 'delete' ? 'var(--danger)' : confirmModal.action === 'unarchive' ? '#15803d' : 'var(--accent)' }}
              >
                {confirmModal.action === 'delete' ? 'Delete' : confirmModal.action === 'archive' ? 'Archive' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
