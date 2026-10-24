import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, Check, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { useAccount, useWriteContract, useSwitchChain, useReadContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import type { PactForm, Question, StartSubmissionResponse } from '../types'
import { PaymentRulesCard } from './PaymentRulesCard'
import { startSubmission, confirmSubmission, submitFreeForm } from '../api'
import { CHAIN_ID, COLLECT_SPLIT_ABI, ESCROW_ABI, getUsdcAddress } from '../contracts'
import { formatUsdc, formatAddress, parseOnchainError, isUserRejection } from '../utils'
import { buildTxExplorerUrl } from '@/onchain-facts'


interface FormFlowProps {
  form: PactForm
  onClose: () => void
}

type Step =
  | { type: 'intro' }
  | { type: 'question'; index: number }
  | { type: 'payment_rules' }
  | { type: 'checkout'; auth: StartSubmissionResponse }
  | { type: 'confirming'; auth: StartSubmissionResponse; txHash: string }
  | { type: 'success'; txHash: string }
  | { type: 'free_success' }
  | { type: 'already_registered' }

interface Answers {
  [questionId: string]: string | string[] | boolean
}

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
}

function QuestionView({
  question,
  value,
  onChange,
  onNext,
  onBack,
  isLast,
  progress,
}: {
  question: Question
  value: string | string[] | boolean | undefined
  onChange: (v: string | string[] | boolean) => void
  onNext: () => void
  onBack: () => void
  isLast: boolean
  progress: number
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150)
    return () => clearTimeout(t)
  }, [question.id])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && question.type !== 'long_text') {
      e.preventDefault()
      onNext()
    }
  }

  const isAnswered = (() => {
    if (!question.required) return true
    if (value === undefined || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    return true
  })()

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar */}
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'var(--accent)' }}
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* Question label */}
      <div>
        <h2 className="text-balance leading-snug" style={{ fontFamily: "'Architects Daughter', cursive", fontSize: '26px', color: 'var(--ink)' }}>
          {question.label}
          {question.required && (
            <span className="ml-1 text-base" style={{ color: 'var(--danger)' }}>*</span>
          )}
        </h2>
        {question.type === 'email' && (
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Only shared with the form creator.
          </p>
        )}
      </div>

      {/* Input */}
      {question.type === 'short_text' && (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={(value as string) || ''}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={question.placeholder || 'Type your answer here...'}
          className="w-full text-xl pb-3 pt-1 outline-none transition-colors"
          style={{
            background: 'transparent',
            borderBottom: '2px solid var(--border-strong)',
            color: 'var(--ink)',
            caretColor: 'var(--accent)',
          }}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--accent)' }}
          onBlur={e => { e.currentTarget.style.borderBottomColor = 'var(--border-strong)' }}
        />
      )}

      {question.type === 'email' && (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="email"
          value={(value as string) || ''}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={question.placeholder || 'your@email.com'}
          className="w-full text-xl pb-3 pt-1 outline-none transition-colors"
          style={{
            background: 'transparent',
            borderBottom: '2px solid var(--border-strong)',
            color: 'var(--ink)',
            caretColor: 'var(--accent)',
          }}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--accent)' }}
          onBlur={e => { e.currentTarget.style.borderBottomColor = 'var(--border-strong)' }}
        />
      )}

      {question.type === 'long_text' && (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={(value as string) || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={question.placeholder || 'Type your answer here...'}
          rows={4}
          className="w-full text-lg pb-3 pt-1 outline-none transition-colors resize-none"
          style={{
            background: 'transparent',
            borderBottom: '2px solid var(--border-strong)',
            color: 'var(--ink)',
            caretColor: 'var(--accent)',
          }}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--accent)' }}
          onBlur={e => { e.currentTarget.style.borderBottomColor = 'var(--border-strong)' }}
        />
      )}

      {question.type === 'yes_no' && (
        <div className="flex gap-3">
          {(['Yes', 'No'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt === 'Yes'); }}
              className="flex-1 py-3 text-base font-medium transition-all"
              style={{
                background: value === (opt === 'Yes') ? 'var(--accent)' : 'transparent',
                color: value === (opt === 'Yes') ? '#fbfaf6' : 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                boxShadow: value === (opt === 'Yes') ? 'var(--shadow-btn)' : 'none',
                fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {question.type === 'single_choice' && Array.isArray(question.options) && question.options.length > 0 && (
        <div className="space-y-2">
          {question.options.map(opt => (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-all"
              style={{
                background: value === opt ? 'var(--accent)' : 'var(--surface)',
                color: value === opt ? '#fbfaf6' : 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                boxShadow: value === opt ? 'var(--shadow-btn)' : 'none',
                fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              }}
            >
              <span
                className="flex size-4 items-center justify-center shrink-0"
                style={{ border: `1px solid ${value === opt ? '#fbfaf6' : 'var(--border)'}`, borderRadius: '50%' }}
              >
                {value === opt && <span className="size-2 rounded-full" style={{ background: '#fbfaf6' }} />}
              </span>
              {opt}
            </button>
          ))}
        </div>
      )}

      {question.type === 'multiple_choice' && Array.isArray(question.options) && question.options.length > 0 && (
        <div className="space-y-2">
          {question.options.map(opt => {
            const selected = (value as string[] || []).includes(opt)
            return (
              <button
                key={opt}
                onClick={() => {
                  const arr = (value as string[] || [])
                  onChange(selected ? arr.filter(v => v !== opt) : [...arr, opt])
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-all"
                style={{
                  background: selected ? 'var(--accent)' : 'var(--surface)',
                  color: selected ? '#fbfaf6' : 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: '3px',
                  boxShadow: selected ? 'var(--shadow-btn)' : 'none',
                  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                }}
              >
                <span
                  className="flex size-4 items-center justify-center shrink-0"
                  style={{
                    border: `1px solid ${selected ? '#fbfaf6' : 'var(--border)'}`,
                    borderRadius: '2px',
                    background: selected ? '#fbfaf6' : 'transparent',
                  }}
                >
                  {selected && <Check className="size-3" style={{ color: 'var(--accent)' }} />}
                </span>
                {opt}
              </button>
            )
          })}
        </div>
      )}

      {/* Fallback: choice question missing options */}
      {(question.type === 'single_choice' || question.type === 'multiple_choice') && (!Array.isArray(question.options) || question.options.length === 0) && (
        <p style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: '13px' }}>No options configured for this question.</p>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="btn-ghost flex items-center gap-2" style={{ minWidth: 0, minHeight: '40px', padding: '8px 16px' }}>
          <ArrowLeft className="size-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!isAnswered}
          className="btn-accent flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          style={{ minWidth: 0, padding: '8px 20px' }}
        >
          {isLast ? 'Review payment' : 'Continue'}
          <ArrowRight className="size-4" />
        </button>
      </div>

      <p className="text-xs" style={{ color: 'var(--subtle)', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        Press Enter to continue{question.required ? ' · Required' : ' · Optional'}
      </p>
    </div>
  )
}

export function FormFlow({ form, onClose }: FormFlowProps) {
  // A form is "effectively free" if it has no payment or price is 0
  const isEffectivelyFree = form.payment_mode === 'free' || parseFloat(form.price_usdc || '0') === 0

  // Check localStorage immediately — if already submitted, open on success screen
  const alreadySubmittedLocally = (() => {
    try { return !!localStorage.getItem(`pactform_sub_${form.id}`) } catch { return false }
  })()

  const [step, setStep] = useState<Step>(alreadySubmittedLocally ? { type: 'free_success' } : { type: 'intro' })
  const [dir, setDir] = useState(1)
  const [answers, setAnswers] = useState<Answers>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payStage, setPayStage] = useState<'idle' | 'approving' | 'registering'>('idle')
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null)

  const { address, isConnected, chainId: walletChainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const wrongChain = isConnected && walletChainId !== CHAIN_ID

  // ── Wagmi hooks ──────────────────────────────────────────────────────────────
  const { writeContractAsync } = useWriteContract()

  // Watch the register tx — transitions confirming → success when mined
  const registerTxHash = step.type === 'confirming' ? (step.txHash as `0x${string}`) : undefined
  const { isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({
    hash: registerTxHash,
    chainId: CHAIN_ID,
    query: { enabled: !!registerTxHash },
  })
  useEffect(() => {
    if (isTxConfirmed && step.type === 'confirming') {
      const txHash = step.txHash
      setTimeout(() => setStep({ type: 'success', txHash }), 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxConfirmed])

  // USDC allowance — read against the contract address from the current auth
  const usdcAddress = getUsdcAddress()
  const contractAddress = step.type === 'checkout' ? step.auth.contract_address : undefined
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && contractAddress
      ? [address, contractAddress as `0x${string}`]
      : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!contractAddress, refetchInterval: 3000 },
  })

  // ── Core payment handler ──────────────────────────────────────────────────
  // Single async function that owns the full flow:
  // 1. Fetch a fresh auth signature right now (always — never use a cached one)
  // 2. If allowance is insufficient → approve, wait for confirm, refetch allowance
  // 3. Submit register tx with the fresh sig, wait for confirm
  const handlePay = useCallback(async () => {
    if (!address) return
    setError(null)
    setLoading(true)

    try {
      // Step 1: fresh auth — fetch immediately before any wallet interaction
      const auth = await startSubmission(form.id, address, answers)
      setStep({ type: 'checkout', auth })

      const priceRaw = BigInt(auth.price_raw)
      const contractAbi = form.payment_mode === 'collect_split' ? COLLECT_SPLIT_ABI : ESCROW_ABI

      // Step 2: approve if needed
      const currentAllowance = (await refetchAllowance()).data ?? 0n
      if (currentAllowance < priceRaw) {
        setPayStage('approving')
        const approveTxHash = await writeContractAsync({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [auth.contract_address as `0x${string}`, priceRaw],
          chainId: CHAIN_ID,
        })
        // Wait for approve confirmation via polling the allowance
        // (wagmi's waitForTransactionReceipt is not needed — we just need the tx mined)
        setApproveTxHash(approveTxHash)
        // Poll allowance until approve confirms (max 60s)
        const pollDeadline = Date.now() + 60_000
        while (Date.now() < pollDeadline) {
          await new Promise(r => setTimeout(r, 1500))
          const { data: refreshed } = await refetchAllowance()
          if ((refreshed ?? 0n) >= priceRaw) break
        }
      }

      // Step 3: fetch a brand-new auth RIGHT before register (approve may have taken minutes)
      const freshAuth = await startSubmission(form.id, address, answers)

      setPayStage('registering')
      const registerTxHash = await writeContractAsync({
        address: freshAuth.contract_address as `0x${string}`,
        abi: contractAbi as never,
        functionName: 'register',
        args: [
          freshAuth.submission_id as `0x${string}`,
          freshAuth.response_commitment as `0x${string}`,
          BigInt(freshAuth.auth_expiry),
          freshAuth.auth_signature as `0x${string}`,
        ],
        chainId: CHAIN_ID,
      })

      setStep({ type: 'confirming', auth: freshAuth, txHash: registerTxHash })
      void confirmSubmission(form.id, freshAuth.submission_id, registerTxHash).catch(() => {})

    } catch (e) {
      if (!isUserRejection(e)) setError(parseOnchainError(e))
      setPayStage('idle')
    } finally {
      setLoading(false)
    }
  }, [address, answers, form.id, form.payment_mode, usdcAddress, writeContractAsync, refetchAllowance])

  const goBack = () => {
    setDir(-1)
    if (step.type === 'question' && step.index > 0) {
      setStep({ type: 'question', index: step.index - 1 })
    } else if (step.type === 'question' && step.index === 0) {
      setStep({ type: 'intro' })
    } else if (step.type === 'payment_rules') {
      if (form.questions.length > 0) {
        setStep({ type: 'question', index: form.questions.length - 1 })
      } else {
        setStep({ type: 'intro' })
      }
    } else if (step.type === 'checkout') {
      setStep({ type: 'payment_rules' })
    }
  }

  const handleAnswerNext = (index: number) => {
    setDir(1)
    if (index < form.questions.length - 1) {
      setStep({ type: 'question', index: index + 1 })
    } else {
      setStep({ type: 'payment_rules' })
    }
  }

  // Free form submit — no wallet or payment needed
  const handleFreeSubmit = async () => {
    setDir(1)
    // Get or create a stable device ID for anonymous duplicate prevention
    const deviceIdKey = 'pactform_device_id'
    let deviceId = localStorage.getItem(deviceIdKey)
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem(deviceIdKey, deviceId)
    }
    // Check localStorage for anonymous duplicate submission
    const lsKey = `pactform_sub_${form.id}`
    if (!address && localStorage.getItem(lsKey)) {
      setStep({ type: 'free_success' })
      return
    }
    setLoading(true)
    setError(null)
    try {
      const submitterAddr = address || undefined
      const result = await submitFreeForm(form.id, submitterAddr, answers, address ? undefined : deviceId)
      // Save to localStorage so anonymous users can't re-submit
      if (!address) localStorage.setItem(lsKey, result.submission_id ?? 'done')
      setStep({ type: 'free_success' })
    } catch (e) {
      const msg = (e as Error).message || ''
      // 409 = already submitted
      if (msg.includes('Already submitted')) {
        setStep({ type: 'free_success' })
        return
      }
      if (!isUserRejection(e)) setError(parseOnchainError(e))
    } finally {
      setLoading(false)
    }
  }

  // Show the checkout screen — or submit directly if effectively free.
  const handleProceedToCheckout = async () => {
    setDir(1)
    // Effectively-free forms skip the wallet/contract flow entirely
    if (isEffectivelyFree) {
      await handleFreeSubmit()
      return
    }
    if (!address) return
    setLoading(true)
    setError(null)
    try {
      const auth = await startSubmission(form.id, address, answers)
      setStep({ type: 'checkout', auth })
    } catch (e) {
      if (!isUserRejection(e)) setError(parseOnchainError(e))
    } finally {
      setLoading(false)
    }
  }

  const progress = (() => {
    const total = form.questions.length + 2 // intro + payment_rules
    if (step.type === 'intro') return 0
    if (step.type === 'question') return ((step.index + 1) / total) * 80
    if (step.type === 'payment_rules') return 85
    if (step.type === 'checkout') return 92
    if (step.type === 'confirming') return 97
    if (step.type === 'success' || step.type === 'free_success') return 100
    return 0
  })()

  const confirmingTxHash = step.type === 'confirming' ? step.txHash : (step.type === 'success' ? step.txHash : null)
  const txUrl = confirmingTxHash ? buildTxExplorerUrl(CHAIN_ID, confirmingTxHash) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(29,31,36,0.55)' }}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="w-full sm:max-w-lg overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '3px 3px 0 0',
          boxShadow: 'rgba(29,31,36,0.9) 4px 4px 0px 0px',
          maxHeight: '92dvh',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Top accent line */}
        <div className="h-[3px] w-full" style={{ background: form.style_accent || 'var(--accent)' }} />

        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-8 h-0.5" style={{ background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div className="px-5 sm:px-6 pt-3 sm:pt-5 pb-3 sm:pb-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="min-w-0">
            <h1
              className="text-balance leading-snug"
              style={{ fontFamily: "'Architects Daughter', cursive", fontSize: '20px', color: 'var(--ink)' }}
            >{form.title}</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
              {isEffectivelyFree ? 'Free' : `${formatUsdc(form.price_usdc)} USDC`} · {form.payment_mode === 'goal_escrow' ? 'Goal Escrow' : isEffectivelyFree ? 'No payment required' : 'Collect & Split'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none mt-0.5 hover:opacity-50 transition-opacity"
            style={{ color: 'var(--muted)', fontFamily: "'IBM Plex Sans', system-ui" }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 pb-6">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={JSON.stringify(step)}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {/* Intro */}
              {step.type === 'intro' && (
                <div className="space-y-5">
                  <p className="text-pretty" style={{ color: 'var(--ink-2)' }}>{form.description}</p>
                  <PaymentRulesCard form={form} />
                  <button
                    onClick={() => {
                      setDir(1)
                      if (form.questions.length > 0) {
                        setStep({ type: 'question', index: 0 })
                      } else {
                        setStep({ type: 'payment_rules' })
                      }
                    }}
                    className="btn-accent w-full"
                    style={{ background: form.style_accent || 'var(--accent)', borderColor: form.style_accent || 'var(--accent)' }}
                  >
                    Start registration <ArrowRight className="size-4" />
                  </button>
                </div>
              )}

              {/* Question */}
              {step.type === 'question' && (
                <QuestionView
                  question={form.questions[step.index]}
                  value={answers[form.questions[step.index].id]}
                  onChange={v => setAnswers(prev => ({ ...prev, [form.questions[step.index].id]: v }))}
                  onNext={() => handleAnswerNext(step.index)}
                  onBack={goBack}
                  isLast={step.index === form.questions.length - 1}
                  progress={progress}
                />
              )}

              {/* Payment rules review */}
              {step.type === 'payment_rules' && (
                <div className="space-y-5">
                  <div>
                    <h2 className="mb-1" style={{ fontFamily: "'Architects Daughter', cursive", fontSize: '20px', color: 'var(--ink)' }}>Review payment terms</h2>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      Read carefully before connecting your wallet. These terms are set onchain and cannot be changed.
                    </p>
                  </div>
                  <PaymentRulesCard form={form} />

                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-xl text-sm" style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)' }}>
                      <AlertCircle className="size-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button onClick={goBack} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
                      <ArrowLeft className="size-4 inline" /> Back
                    </button>

                    {!isConnected ? (
                      <div className="flex-1">
                        <ConnectKitButton.Custom>
                          {({ show }) => (
                            <button
                              onClick={show}
                              className="btn-accent w-full"
                              style={{ background: form.style_accent || 'var(--accent)' }}
                            >
                              Connect wallet to continue
                            </button>
                          )}
                        </ConnectKitButton.Custom>
                      </div>
                    ) : wrongChain ? (
                      <button
                        onClick={() => switchChain({ chainId: CHAIN_ID })}
                        className="btn-accent flex-1"
                        style={{ background: 'var(--danger)' }}
                      >
                        Switch to Arc Mainnet
                      </button>
                    ) : isEffectivelyFree ? (
                      <button
                        onClick={() => { void handleFreeSubmit() }}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
                        style={{ background: form.style_accent || 'var(--accent)' }}
                      >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        {loading ? 'Submitting...' : 'Submit'}
                      </button>
                    ) : (
                      <button
                        onClick={() => { void handleProceedToCheckout() }}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
                        style={{ background: form.style_accent || 'var(--accent)' }}
                      >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                        {loading ? 'Preparing...' : 'Proceed to checkout'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Checkout */}
              {step.type === 'checkout' && (
                <CheckoutView
                  form={form}
                  auth={step.auth}
                  allowance={allowance}
                  isConnected={isConnected}
                  wrongChain={wrongChain}
                  payStage={payStage}
                  isPaying={loading}
                  approveTxHash={approveTxHash}
                  onBack={goBack}
                  onSwitchChain={() => switchChain({ chainId: CHAIN_ID })}
                  onPay={() => { void handlePay() }}
                  error={error}
                />
              )}

              {/* Confirming */}
              {step.type === 'confirming' && (
                <div className="space-y-5 py-4 text-center">
                  <div className="flex justify-center">
                    <Loader2 className="size-12 animate-spin" style={{ color: form.style_accent || 'var(--accent)' }} />
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "\"Architects Daughter\", cursive", fontSize: "20px", color: 'var(--ink)' }}>Confirming on Arc</h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                      Your transaction is being confirmed on the blockchain.
                    </p>
                  </div>
                  {step.txHash && (
                    <a
                      href={buildTxExplorerUrl(CHAIN_ID, step.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium"
                      style={{ color: 'var(--accent)' }}
                    >
                      View on ArcScan <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              )}

              {/* Success */}
              {step.type === 'success' && (
                <div className="space-y-5 py-4 text-center">
                  <div
                    className="mx-auto flex size-14 items-center justify-center rounded-full"
                    style={{ background: 'rgba(21,128,61,0.12)' }}
                  >
                    <Check className="size-7" style={{ color: 'var(--success)' }} />
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "\"Architects Daughter\", cursive", fontSize: "20px", color: 'var(--success)' }}>
                      Registration confirmed!
                    </h2>
                    <p className="text-sm mt-2 text-pretty" style={{ color: 'var(--muted)' }}>
                      {form.confirmation_message}
                    </p>
                  </div>
                  <div className="p-3 text-left space-y-1.5 text-xs" style={{ background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "3px" }}>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--muted)' }}>Amount paid</span>
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatUsdc(form.price_usdc)} USDC</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--muted)' }}>Network</span>
                      <span style={{ color: 'var(--ink)' }}>Arc Testnet</span>
                    </div>
                    {txUrl && (
                      <div className="flex justify-between items-center">
                        <span style={{ color: 'var(--muted)' }}>Transaction</span>
                        <a href={txUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium" style={{ color: 'var(--accent)' }}>
                          View on ArcScan <ExternalLink className="size-3" />
                        </a>
                      </div>
                    )}
                    {form.payment_mode === 'goal_escrow' && (
                      <p className="pt-1 text-xs" style={{ color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                        Your payment is in escrow. Check your wallet for refund eligibility if the goal isn't reached.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={onClose}
                    className="btn-accent w-full"
                    style={{ background: form.style_accent || 'var(--accent)' }}
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Free form success */}
              {step.type === 'free_success' && (
                <div className="space-y-4 py-4 text-center">
                  <div
                    className="mx-auto flex size-12 items-center justify-center rounded-full"
                    style={{ background: 'rgba(21,128,61,0.12)' }}
                  >
                    <Check className="size-6" style={{ color: 'var(--success)' }} />
                  </div>
                  <h2 style={{ fontFamily: "\"Architects Daughter\", cursive", fontSize: "20px", color: 'var(--ink)' }}>
                    {alreadySubmittedLocally ? 'Already submitted' : 'Submitted!'}
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {alreadySubmittedLocally
                      ? 'You have already submitted this form from this device.'
                      : (form.confirmation_message || 'Thank you for your submission.')}
                  </p>
                  <button
                    onClick={onClose}
                    className="btn-accent w-full"
                    style={{ background: form.style_accent || 'var(--accent)' }}
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Already registered */}
              {step.type === 'already_registered' && (
                <div className="space-y-4 py-4 text-center">
                  <div
                    className="mx-auto flex size-12 items-center justify-center rounded-full"
                    style={{ background: 'rgba(21,128,61,0.12)' }}
                  >
                    <Check className="size-6" style={{ color: 'var(--success)' }} />
                  </div>
                  <h2 style={{ fontFamily: "\"Architects Daughter\", cursive", fontSize: "20px", color: 'var(--ink)' }}>Already registered</h2>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    This wallet has already registered for this form.
                  </p>
                  <button onClick={onClose} className="w-full py-3 rounded-2xl text-sm font-semibold" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
                    Close
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

function CheckoutView({
  form,
  auth,
  allowance,
  isConnected: _isConnected,
  wrongChain,
  payStage,
  isPaying,
  approveTxHash,
  onBack,
  onSwitchChain,
  onPay,
  error,
}: {
  form: PactForm
  auth: StartSubmissionResponse
  allowance: bigint | undefined
  isConnected: boolean   // reserved for future gating
  wrongChain: boolean
  payStage: 'idle' | 'approving' | 'registering'
  isPaying: boolean
  approveTxHash: string | null
  onBack: () => void
  onSwitchChain: () => void
  onPay: () => void
  error: string | null
}) {
  const priceRaw = auth ? BigInt(auth.price_raw) : 0n
  const hasAllowance = (allowance ?? 0n) >= priceRaw
  const willNeedApproval = !hasAllowance

  const buttonLabel = (() => {
    if (wrongChain) return 'Switch to Arc Mainnet'
    if (payStage === 'approving') return <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Approving USDC...</span>
    if (payStage === 'registering') return <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Confirm in wallet...</span>
    if (isPaying) return <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Preparing...</span>
    return `Pay ${formatUsdc(form.price_usdc)} USDC`
  })()

  const isLoading = isPaying || payStage !== 'idle'

  return (
    <div className="space-y-5">
      <div>
        <h2 style={{ fontFamily: "\"Architects Daughter\", cursive", fontSize: "20px", color: 'var(--ink)' }}>Checkout</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Review the payment details before confirming.
        </p>
      </div>

      {/* Summary */}
      <div className="p-4 space-y-2.5 text-sm" style={{ background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "3px" }}>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0" style={{ color: 'var(--muted)' }}>Form</span>
          <span className="font-medium text-right" style={{ color: 'var(--ink)' }}>{form.title}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0" style={{ color: 'var(--muted)' }}>Amount</span>
          <span className="display font-700 tabular-nums" style={{ color: 'var(--ink)' }}>
            {formatUsdc(form.price_usdc)} USDC
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0" style={{ color: 'var(--muted)' }}>Network</span>
          <span style={{ color: 'var(--ink)' }}>Arc Mainnet</span>
        </div>
        {auth?.contract_address && (
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0" style={{ color: 'var(--muted)' }}>Contract</span>
            <span className="mono text-xs" style={{ color: 'var(--ink)' }}>
              {formatAddress(auth.contract_address)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0" style={{ color: 'var(--muted)' }}>Mode</span>
          <span style={{ color: 'var(--ink)' }}>
            {form.payment_mode === 'goal_escrow' ? 'Goal Escrow' : form.payment_mode === 'free' ? 'Free' : 'Collect & Split'}
          </span>
        </div>
        {willNeedApproval && !isLoading && (
          <div
            className="pt-2 text-xs"
            style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}
          >
            Clicking Pay will: 1) approve USDC, then 2) register — two wallet confirmations.
          </div>
        )}
        {payStage === 'approving' && approveTxHash && (
          <div className="pt-2 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
            Step 1/2: USDC approval confirming...{' '}
            <a href={`https://explorer.arc.io/tx/${approveTxHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              View tx
            </a>
          </div>
        )}
        {payStage === 'registering' && (
          <div className="pt-2 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
            Step 2/2: Confirm registration in your wallet...
          </div>
        )}
      </div>

      <PaymentRulesCard form={form} compact />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl text-sm" style={{ background: 'rgba(190,18,60,0.08)', color: 'var(--danger)' }}>
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
        >
          <ArrowLeft className="size-4 inline" /> Back
        </button>

        <button
          onClick={wrongChain ? onSwitchChain : onPay}
          disabled={isLoading && !wrongChain}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{ background: wrongChain ? 'var(--danger)' : (form.style_accent || 'var(--accent)') }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}
