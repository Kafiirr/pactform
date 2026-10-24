import { Users, Clock, Target, Zap, ArrowRight } from 'lucide-react'
import type { PactForm } from '../types'
import { formatUsdc, isDeadlinePassed, timeUntilDeadline, splitPercent } from '../utils'

interface FormCardProps {
  form: PactForm
  onClick: () => void
}

export function FormCard({ form, onClick }: FormCardProps) {
  const deadlinePassed = isDeadlinePassed(form.deadline_ts)
  const isEscrow = form.payment_mode === 'goal_escrow'
  const isFree = form.payment_mode === 'free' || parseFloat(form.price_usdc || '0') === 0
  const isDisabled = deadlinePassed && isEscrow
  const activeRecipients = form.recipients.filter(r => r && r !== '0x0000000000000000000000000000000000000000')

  return (
    <button
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      className="w-full text-left p-5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '3px',
        boxShadow: 'var(--shadow-card)',
        transition: 'transform 80ms, box-shadow 80ms',
      }}
      onMouseEnter={e => {
        if (!isDisabled) {
          (e.currentTarget as HTMLElement).style.transform = 'translate(-2px,-2px)'
          ;(e.currentTarget as HTMLElement).style.boxShadow = 'rgba(29,31,36,0.9) 5px 5px 0px 0px'
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = ''
        ;(e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-card)'
      }}
    >
      {/* Accent bar — top border override */}
      <div
        className="h-0.5 w-10 mb-4"
        style={{ background: form.style_accent || 'var(--accent)' }}
      />

      {/* Mode tag */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="tag"
          style={{
            borderColor: isEscrow ? form.style_accent || 'var(--accent)' : 'var(--border)',
            color: isEscrow ? form.style_accent || 'var(--accent)' : 'var(--ink-2)',
          }}
        >
          {isEscrow ? <Target className="size-3" /> : isFree ? <ArrowRight className="size-3" /> : <Zap className="size-3" />}
          {isEscrow ? 'Goal Escrow' : isFree ? 'Free' : 'Collect & Split'}
        </span>
        {isEscrow && deadlinePassed && (
          <span className="tag" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Closed</span>
        )}
      </div>

      {/* Title */}
      <h3
        className="text-balance mb-2 leading-snug"
        style={{ fontFamily: "'Architects Daughter', cursive", fontSize: '20px', color: 'var(--ink)' }}
      >
        {form.title}
      </h3>

      {/* Description */}
      <p
        className="text-sm line-clamp-2 mb-4"
        style={{ color: 'var(--muted)', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
      >
        {form.description}
      </p>

      {/* Stats */}
      <div className="flex items-center gap-4 flex-wrap">
        <span
          className="text-base tabular-nums font-semibold"
          style={{ color: 'var(--ink)', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
        >
          {isFree ? 'Free' : `${formatUsdc(form.price_usdc)} USDC`}
        </span>

        {isEscrow && form.goal_count > 0 && (
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <Target className="size-3" />
            Goal: {form.goal_count}
          </span>
        )}

        {isEscrow && form.deadline_ts > 0 && (
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: deadlinePassed ? 'var(--danger)' : 'var(--muted)' }}
          >
            <Clock className="size-3" />
            {deadlinePassed ? 'Deadline passed' : timeUntilDeadline(form.deadline_ts)}
          </span>
        )}

        {activeRecipients.length > 1 && (
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <Users className="size-3" />
            {form.splits.filter(s => s > 0).map(splitPercent).join(' / ')}
          </span>
        )}
      </div>

      {/* CTA */}
      {!isDisabled && (
        <div
          className="mt-4 flex items-center gap-1 text-sm font-medium"
          style={{ color: form.style_accent || 'var(--accent)', fontFamily: "'Architects Daughter', cursive" }}
        >
          Register now <ArrowRight className="size-4" />
        </div>
      )}
    </button>
  )
}
