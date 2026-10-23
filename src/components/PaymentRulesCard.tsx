import React from 'react'
import { Info, Target, Zap, Clock, Users, AlertCircle } from 'lucide-react'
import type { PactForm } from '../types'
import { formatUsdc, formatDeadline, timeUntilDeadline, splitPercent, isDeadlinePassed, formatAddress } from '../utils'

interface PaymentRulesCardProps {
  form: PactForm
  compact?: boolean
}

export function PaymentRulesCard({ form, compact }: PaymentRulesCardProps) {
  const isEscrow = form.payment_mode === 'goal_escrow'
  const isFree = form.payment_mode === 'free'
  const deadlinePassed = isDeadlinePassed(form.deadline_ts)

  const activeRecipients = form.recipients
    .map((r, i) => ({ address: r, split: form.splits[i] || 0 }))
    .filter(r => r.address && r.address !== '0x0000000000000000000000000000000000000000' && r.split > 0)

  if (isFree) {
    if (compact) {
      return (
        <div
          className="rounded-xl p-3 text-xs"
          style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}
        >
          <div className="flex items-start gap-2">
            <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: '#6366f1' }} />
            <span style={{ color: 'var(--ink-2)' }}>This form is free to submit — no payment required.</span>
          </div>
        </div>
      )
    }
    return (
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div
            className="flex size-6 items-center justify-center rounded-lg"
            style={{ background: 'rgba(99,102,241,0.12)' }}
          >
            <Zap className="size-3.5" style={{ color: '#6366f1' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Submission terms</span>
        </div>
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Registration fee</span>
            <span className="display text-sm font-700" style={{ color: '#6366f1' }}>Free</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Payment mode</span>
            <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>No payment required</span>
          </div>
        </div>
        <p className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
          Your responses are stored securely. No wallet or USDC required.
        </p>
      </div>
    )
  }

  if (compact) {
    return (
      <div
        className="rounded-xl p-3 text-xs"
        style={{ background: 'rgba(180,83,9,0.06)', border: '1px solid rgba(180,83,9,0.15)' }}
      >
        <div className="flex items-start gap-2">
          <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <div style={{ color: 'var(--ink-2)' }}>
            {isEscrow
              ? `Pay ${formatUsdc(form.price_usdc)} USDC. If ${form.goal_count} registrations by ${formatDeadline(form.deadline_ts)}: funds split ${activeRecipients.map(r => splitPercent(r.split)).join('/')}. Otherwise, full refund.`
              : `Pay ${formatUsdc(form.price_usdc)} USDC, credited immediately to recipients (${activeRecipients.map(r => splitPercent(r.split)).join('/')}).`
            }
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="flex size-6 items-center justify-center rounded-lg"
          style={{ background: isEscrow ? 'rgba(180,83,9,0.12)' : 'rgba(21,128,61,0.12)' }}
        >
          {isEscrow
            ? <Target className="size-3.5" style={{ color: 'var(--accent)' }} />
            : <Zap className="size-3.5" style={{ color: 'var(--success)' }} />
          }
        </div>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          Payment terms
        </span>
      </div>

      <div className="space-y-2.5">
        {/* Price */}
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Registration fee</span>
          <span className="display text-sm font-700 tabular-nums" style={{ color: 'var(--ink)' }}>
            {formatUsdc(form.price_usdc)} USDC
          </span>
        </div>

        {/* Mode */}
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Payment mode</span>
          <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
            {isEscrow ? 'Goal Escrow' : 'Collect & Split'}
          </span>
        </div>

        {/* Recipients */}
        {activeRecipients.length > 0 && (
          <div>
            <span className="text-xs block mb-1.5" style={{ color: 'var(--muted)' }}>
              {isEscrow ? 'Recipients (if goal reached)' : 'Recipients'}
            </span>
            <div className="space-y-1">
              {activeRecipients.map((r, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
                    {formatAddress(r.address)}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    {splitPercent(r.split)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Goal (escrow) */}
        {isEscrow && (
          <>
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                <span className="flex items-center gap-1"><Target className="size-3" /> Goal</span>
              </span>
              <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
                {form.goal_count} paid registrations
              </span>
            </div>

            {form.deadline_ts > 0 && (
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1"><Clock className="size-3" /> Deadline</span>
                </span>
                <span
                  className="text-xs font-medium"
                  style={{ color: deadlinePassed ? 'var(--danger)' : 'var(--ink)' }}
                >
                  {deadlinePassed ? 'Passed' : timeUntilDeadline(form.deadline_ts)}
                  <span className="block text-right" style={{ color: 'var(--subtle)', fontSize: '0.65rem' }}>
                    {formatDeadline(form.deadline_ts)}
                  </span>
                </span>
              </div>
            )}
          </>
        )}

        {form.capacity > 0 && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <Users className="size-3" /> Capacity
            </span>
            <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
              {form.capacity} spots
            </span>
          </div>
        )}
      </div>

      {/* Escrow conditions */}
      {isEscrow && (
        <div
          className="mt-3 pt-3 space-y-1.5 text-xs"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          <div className="flex items-start gap-2">
            <span className="text-green-600 mt-0.5">✓</span>
            <span>Goal reached: proceeds split to recipients per the percentages above.</span>
          </div>
          <div className="flex items-start gap-2">
            <span style={{ color: 'var(--danger)' }} className="mt-0.5">✗</span>
            <span>Goal missed or creator cancels: you can claim your full registration payment back.</span>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="size-3 shrink-0 mt-0.5" />
            <span>The success condition is {form.goal_count} paid registrations — not proof of workshop delivery. Gas fees are separate from registration fees.</span>
          </div>
        </div>
      )}

      {!isEscrow && (
        <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          Your payment is credited to recipients immediately upon confirmation. No refunds.
        </p>
      )}
    </div>
  )
}
