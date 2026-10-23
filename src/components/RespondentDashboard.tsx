import React, { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Loader2, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
import type { RespondentSubmission } from '../types'
import { getRespondentSubmissions } from '../api'
import { CHAIN_ID, ESCROW_ABI, COLLECT_SPLIT_ABI } from '../contracts'
import { formatUsdc, parseOnchainError, isUserRejection, timeUntilDeadline } from '../utils'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Per-submission card with live onchain state
// ---------------------------------------------------------------------------

function SubmissionCard({
  sub,
  address,
  wrongChain,
  onSwitchChain,
  onActionDone,
}: {
  sub: RespondentSubmission
  address: string
  wrongChain: boolean
  onSwitchChain: () => void
  onActionDone: () => void
}) {
  const isEscrow = sub.payment_mode === 'goal_escrow'
  const contractAddr = sub.contract_address as `0x${string}` | undefined

  // ── Live onchain reads ──────────────────────────────────────────────────
  const { data: escrowStatus, refetch: refetchStatus } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'status',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: finalized, refetch: refetchFinalized } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'finalized',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: refundsEnabled, refetch: refetchRefunds } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'refundsEnabled',
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
  const { data: registrationCount } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'registrationCount',
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr },
  })
  const { data: goalCount } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'goalCount',
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
  const { data: refundable } = useReadContract({
    address: contractAddr,
    abi: ESCROW_ABI as never,
    functionName: 'refundable',
    args: [address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: isEscrow && !!contractAddr && !!address },
  })
  // Collect & Split: withdrawable balance for this address
  const { data: withdrawable, refetch: refetchWithdrawable } = useReadContract({
    address: contractAddr,
    abi: COLLECT_SPLIT_ABI as never,
    functionName: 'withdrawable',
    args: [address as `0x${string}`],
    chainId: CHAIN_ID,
    query: { enabled: !isEscrow && !!contractAddr && !!address },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: CHAIN_ID,
  })

  useEffect(() => {
    if (isSuccess) {
      toast.success('Transaction confirmed!')
      void refetchStatus()
      void refetchFinalized()
      void refetchRefunds()
      void refetchWithdrawable()
      onActionDone()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const isBusy = isPending || isConfirming

  // ── Derived escrow state ────────────────────────────────────────────────
  // status: 0=Active, 1=GoalReached, 2=GoalMissed, 3=Cancelled
  const statusNum = typeof escrowStatus === 'number' ? escrowStatus : Number(escrowStatus ?? 0)
  const deadlineTs = typeof deadline === 'bigint' ? Number(deadline) : Number(deadline ?? sub.deadline_ts ?? 0)
  const nowTs = Math.floor(Date.now() / 1000)
  const deadlinePassed = deadlineTs > 0 && nowTs >= deadlineTs
  const regsNum = Number(registrationCount ?? 0)
  const goalNum = Number(goalCount ?? sub.goal_count ?? 0)
  const capNum = Number(capacity ?? 0)
  const goalMet = regsNum >= goalNum && goalNum > 0
  // Contract finalize() requires: deadline passed OR capacity filled
  // goalMet alone is NOT sufficient — deadline must pass first
  const capacityFilled = capNum > 0 && regsNum >= capNum
  const canFinalize = isEscrow && !finalized && (deadlinePassed || capacityFilled)
  const canRefund = isEscrow && !!refundsEnabled && (BigInt((refundable as bigint | undefined) ?? 0n) > 0n)
  const canWithdrawEscrow = isEscrow && statusNum === 1 /* GoalReached */
  // Registration is blocked once deadline has passed
  const registrationClosed = isEscrow && deadlinePassed && !finalized

  // Collect & Split: show withdraw if there's a balance
  const withdrawableAmount = BigInt((withdrawable as bigint | undefined) ?? 0n)
  const canWithdrawCS = !isEscrow && withdrawableAmount > 0n

  const doWrite = (functionName: string, abi: readonly unknown[], args: unknown[] = []) => {
    if (!contractAddr) return
    if (wrongChain) { onSwitchChain(); return }
    try {
      writeContract({
        address: contractAddr,
        abi: abi as never,
        functionName,
        args,
        chainId: CHAIN_ID,
      })
    } catch (e) {
      if (!isUserRejection(e)) toast.error(parseOnchainError(e))
    }
  }

  // ── Status label ────────────────────────────────────────────────────────
  const statusLabel = () => {
    if (!isEscrow) return { label: 'Registered', color: 'var(--success)', bg: 'rgba(21,128,61,0.10)' }
    if (!finalized) {
      if (goalMet) return { label: 'Goal reached', color: '#b45309', bg: 'rgba(180,83,9,0.10)' }
      if (deadlinePassed) return { label: 'Deadline passed', color: 'var(--danger)', bg: 'rgba(190,18,60,0.08)' }
      return { label: 'In escrow', color: 'var(--muted)', bg: 'var(--surface-muted)' }
    }
    if (statusNum === 1) return { label: 'Goal reached', color: 'var(--success)', bg: 'rgba(21,128,61,0.10)' }
    if (statusNum === 2) return { label: 'Goal missed — refund available', color: 'var(--danger)', bg: 'rgba(190,18,60,0.08)' }
    return { label: 'Finalized', color: 'var(--muted)', bg: 'var(--surface-muted)' }
  }
  const sl = statusLabel()

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="display text-base font-600" style={{ color: 'var(--ink)' }}>{sub.title}</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {isEscrow ? 'Goal Escrow' : 'Collect & Split'} · {formatUsdc(sub.price_usdc)} USDC
          </p>
        </div>
        <span
          className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ background: sl.bg, color: sl.color }}
        >
          {sl.label}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}>
          <p className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>Amount paid</p>
          <p className="display text-sm font-700 tabular-nums" style={{ color: 'var(--ink)' }}>
            {formatUsdc(sub.price_usdc)} USDC
          </p>
        </div>
        {isEscrow && deadlineTs > 0 && (
          <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}>
            <p className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>Deadline</p>
            <p className="text-sm font-medium" style={{ color: deadlinePassed ? 'var(--danger)' : 'var(--ink)' }}>
              {deadlinePassed ? 'Passed' : timeUntilDeadline(deadlineTs)}
            </p>
          </div>
        )}
        {isEscrow && goalNum > 0 && (
          <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}>
            <p className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>Registrations</p>
            <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {regsNum} / {goalNum}
            </p>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="space-y-2">

        {/* Collect & Split: withdraw credited balance */}
        {canWithdrawCS && (
          <button
            onClick={() => doWrite('withdraw', COLLECT_SPLIT_ABI)}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isBusy ? 'Processing…' : `Withdraw ${formatUsdc(String(Number(withdrawableAmount) / 1e6))} USDC`}
          </button>
        )}

        {/* Escrow: finalize (anyone can call once eligible) */}
        {canFinalize && (
          <button
            onClick={() => doWrite('finalize', ESCROW_ABI)}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: goalMet ? '#15803d' : 'var(--accent)' }}
          >
            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isBusy ? 'Processing…' : goalMet ? 'Finalize (goal reached)' : 'Finalize (deadline passed)'}
          </button>
        )}

        {/* Escrow GoalReached: withdraw credited share */}
        {canWithdrawEscrow && (
          <button
            onClick={() => doWrite('withdraw', ESCROW_ABI)}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: '#15803d' }}
          >
            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isBusy ? 'Processing…' : 'Withdraw your share'}
          </button>
        )}

        {/* Escrow GoalMissed: claim refund */}
        {canRefund && (
          <button
            onClick={() => doWrite('claimRefund', ESCROW_ABI)}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)', border: '1px solid rgba(190,18,60,0.2)' }}
          >
            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isBusy ? 'Processing…' : `Claim refund — ${formatUsdc(sub.price_usdc)} USDC`}
          </button>
        )}

        {/* Escrow still active — show status text */}
        {isEscrow && !canFinalize && !canRefund && !canWithdrawEscrow && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {registrationClosed
              ? 'Deadline passed — awaiting finalization.'
              : goalMet
              ? `Goal reached (${regsNum}/${goalNum}). Finalize becomes available after deadline: ${timeUntilDeadline(deadlineTs)} remaining.`
              : `${regsNum} of ${goalNum} registrations · ${timeUntilDeadline(deadlineTs)} until deadline`}
          </p>
        )}
      </div>

      {/* Explorer link */}
      {sub.tx_hash && (
        <a
          href={buildTxExplorerUrl(5042, sub.tx_hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--accent)' }}
        >
          <ExternalLink className="size-3.5" /> View registration on ArcScan
        </a>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function RespondentDashboard() {
  const { address, isConnected, chainId: walletChainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const [subs, setSubs] = useState<RespondentSubmission[]>([])
  const [loading, setLoading] = useState(false)

  const wrongChain = isConnected && walletChainId !== CHAIN_ID

  const load = async () => {
    if (!address) return
    setLoading(true)
    try {
      const data = await getRespondentSubmissions(address)
      setSubs(data.forms)
    } catch { } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isConnected && address) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected])

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 px-4">
        <p className="text-lg font-medium" style={{ color: 'var(--ink)' }}>Connect your wallet to view registrations.</p>
        <ConnectKitButton />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="display text-2xl font-600" style={{ color: 'var(--ink)' }}>My Registrations</h2>
        <button
          onClick={() => { void load() }}
          className="p-2 rounded-lg hover:opacity-70 transition-opacity"
          style={{ color: 'var(--muted)' }}
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {wrongChain && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm"
          style={{ background: 'rgba(190,18,60,0.08)', border: '1px solid rgba(190,18,60,0.2)', color: 'var(--danger)' }}
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>Switch to Arc Testnet to take actions.</span>
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            className="ml-auto font-semibold text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--danger)', color: 'white' }}
          >
            Switch
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : subs.length === 0 ? (
        <div className="text-center py-16 rounded-3xl" style={{ background: 'var(--surface-muted)' }}>
          <p className="text-lg font-medium mb-2" style={{ color: 'var(--ink)' }}>No registrations yet</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Register for a form to see it here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {subs.map(sub => (
            <SubmissionCard
              key={sub.id}
              sub={sub}
              address={address!}
              wrongChain={wrongChain}
              onSwitchChain={() => switchChain({ chainId: CHAIN_ID })}
              onActionDone={() => void load()}
            />
          ))}
        </div>
      )}
    </div>
  )
}
