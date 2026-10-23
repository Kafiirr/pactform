// PACTFORM shared types

export type PaymentMode = 'collect_split' | 'goal_escrow' | 'free'
export type FormStatus = 'draft' | 'published' | 'archived'
export type SubmissionStatus = 'pending' | 'authorized' | 'confirmed' | 'failed'

export type QuestionType = 'short_text' | 'long_text' | 'email' | 'single_choice' | 'multiple_choice' | 'yes_no'

export interface Question {
  id: string
  type: QuestionType
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface PactForm {
  id: string
  creator_address: string
  title: string
  description: string
  confirmation_message: string
  payment_mode: PaymentMode
  price_usdc: string
  capacity: number
  goal_count: number
  deadline_ts: number
  recipients: string[]
  splits: number[]
  questions: Question[]
  status: FormStatus
  contract_address: string | null
  chain_id: number | null
  version: number
  created_at: number
  published_at: number | null
  style_accent: string
}

export interface Submission {
  id: string
  form_id: string
  payer_address: string
  status: SubmissionStatus
  tx_hash: string | null
  created_at: number
  confirmed_at: number | null
  response_commitment?: string
  response_data?: Record<string, unknown>
}

export interface StartSubmissionResponse {
  submission_id: string
  auth_signature: string
  auth_expiry: string
  response_commitment: string
  price_raw: string
  contract_address: string
  chain_id: number
  signer_address: string
}

export interface RespondentSubmission extends Submission {
  title: string
  payment_mode: PaymentMode
  price_usdc: string
  contract_address: string | null
  chain_id: number | null
  goal_count: number
  capacity: number
  deadline_ts: number
  recipients: string[]
  splits: number[]
}
