// PACTFORM utility functions

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatUsdc(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function parseUsdcRaw(amount: string): bigint {
  const [integer, fractional = ''] = amount.split('.')
  const frac = fractional.padEnd(6, '0').slice(0, 6)
  return BigInt(integer) * 1_000_000n + BigInt(frac)
}

export function formatUsdcRaw(raw: bigint): string {
  const integer = raw / 1_000_000n
  const frac = raw % 1_000_000n
  return `${integer}.${frac.toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')}`
}

export function formatDeadline(ts: number): string {
  if (!ts) return 'No deadline'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function isDeadlinePassed(ts: number): boolean {
  if (!ts) return false
  return Date.now() / 1000 > ts
}

export function timeUntilDeadline(ts: number): string {
  if (!ts) return ''
  const diff = ts - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'Deadline passed'
  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)
  const mins = Math.floor((diff % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h remaining`
  if (hours > 0) return `${hours}h ${mins}m remaining`
  return `${mins}m remaining`
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function isUserRejection(error: unknown): boolean {
  const msg = ((error as { message?: string })?.message ?? '').toLowerCase()
  const code = (error as { code?: number | string })?.code
  return (
    msg.includes('user rejected') ||
    msg.includes('user denied') ||
    msg.includes('rejected the request') ||
    msg.includes('action_rejected') ||
    code === 4001 ||
    code === 'ACTION_REJECTED'
  )
}

export function parseOnchainError(error: unknown): string {
  const message = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (message.includes('user rejected') || (error as { code?: number })?.code === 4001) {
    return 'Transaction cancelled.'
  }
  if (message.includes('insufficient') || message.includes('exceeds balance')) {
    return 'Insufficient USDC balance. Please add funds.'
  }
  if (message.includes('alreadyregistered')) {
    return 'This wallet is already registered for this form.'
  }
  if (message.includes('capacityexceeded')) {
    return 'This form has reached its capacity.'
  }
  if (message.includes('authorizationexpired')) {
    return 'Your authorization has expired. Please try again.'
  }
  if (message.includes('authorizationused')) {
    return 'This authorization has already been used.'
  }
  if (message.includes('reverted')) {
    const reasonMatch = message.match(/reason="([^"]+)"/)
    return reasonMatch ? `Transaction failed: ${reasonMatch[1]}` : 'Transaction failed. Please try again.'
  }
  if (message.includes('network') || message.includes('timeout')) {
    return 'Network error. Please check your connection.'
  }
  return 'Something went wrong. Please try again.'
}

export function splitPercent(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`
}
