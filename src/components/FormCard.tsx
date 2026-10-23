import React from 'react'
import { Users, Clock, Target, ArrowRight, Zap } from 'lucide-react'
import type { PactForm } from '../types'
import { formatUsdc, isDeadlinePassed, timeUntilDeadline, splitPercent } from '../utils'

interface FormCardProps {
  form: PactForm
  onClick: () => void
}

export function FormCard({ form, onClick }: FormCardProps) {
  const deadlinePassed = isDeadlinePassed(form.deadline_ts)
  const isEscrow = form.payment_mode === 'goal_escrow'
  const isFree = form.payment_mode === 'free'

  const activeRecipients = form.recipients.filter(r => r && r !== '0x0000000000000000000000000000000000000000')

  return (
    <button
      onClick={deadlinePassed && isEscrow ? undefined : onClick}
      disabled={deadlinePassed && isEscrow}
      className="w-full text-left rounded-2xl p-5 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
      style={{
        background: 'var(--surface)',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(26,18,9,0.06)',
      }}
    >
      {/* Accent strip */}
      <div
        className="h-1 w-12 rounded-full mb-4"
        style={{ background: form.style_accent || 'var(--accent)' }}
      />

      {/* Mode badge */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{
            background: isEscrow ? 'rgba(180,83,9,0.10)' : isFree ? 'rgba(99,102,241,0.10)' : 'rgba(21,128,61,0.10)',
            color: isEscrow ? 'var(--accent)' : isFree ? '#6366f1' : 'var(--success)',
          }}
        >
          {isEscrow ? <Target className="size-3" /> : isFree ? <ArrowRight className="size-3" /> : <Zap className="size-3" />}
          {isEscrow ? 'Goal Escrow' : isFree ? 'Free' : 'Collect & Split'}
        </span>

        {isEscrow && deadlinePassed && (
          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Deadline passed</span>
        )}
      </div>

      {/* Title */}
      <h3 className="display text-lg font-600 text-balance mb-2" style={{ color: 'var(--ink)' }}>
        {form.title}
      </h3>

      {/* Description */}
      <p className="text-sm text-pretty line-clamp-2 mb-4" style={{ color: 'var(--muted)' }}>
        {form.description}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Price */}
        <div className="flex items-center gap-1">
          <span className="display text-base font-700 tabular-nums" style={{ color: isFree ? '#6366f1' : 'var(--ink)' }}>
            {isFree ? 'Free' : `${formatUsdc(form.price_usdc)} USDC`}
          </span>
        </div>

        {/* Goal (escrow only) */}
        {isEscrow && form.goal_count > 0 && (
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <Target className="size-3" />
            <span>Goal: {form.goal_count} registrations</span>
          </div>
        )}

        {/* Deadline */}
        {isEscrow && form.deadline_ts > 0 && (
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: deadlinePassed ? 'var(--danger)' : 'var(--muted)' }}
          >
            <Clock className="size-3" />
            <span>{deadlinePassed ? 'Deadline passed' : timeUntilDeadline(form.deadline_ts)}</span>
          </div>
        )}

        {/* Recipients */}
        {activeRecipients.length > 0 && (
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <Users className="size-3" />
            <span>
              {activeRecipients.length === 1
                ? '100% to creator'
                : form.splits.filter(s => s > 0).map(splitPercent).join(' / ')
              }
            </span>
          </div>
        )}
      </div>

      {/* CTA */}
      <div
        className="mt-4 flex items-center gap-1 text-sm font-semibold"
        style={{ color: deadlinePassed && isEscrow ? 'var(--muted)' : (form.style_accent || 'var(--accent)') }}
      >
        {deadlinePassed && isEscrow ? 'Registration closed' : <>Register now <ArrowRight className="size-4" /></>}
      </div>
    </button>
  )
}
