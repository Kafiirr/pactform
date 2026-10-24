// PACTFORM API client — calls go through /api (Vite proxy in dev, Vercel functions in prod)

import type { PactForm, StartSubmissionResponse, Submission, RespondentSubmission } from './types'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export async function getPublishedForms(): Promise<PactForm[]> {
  const data = await request<{ forms: PactForm[] }>('/forms')
  return data.forms
}

export async function getForm(id: string): Promise<PactForm> {
  const data = await request<{ form: PactForm }>(`/forms/${id}`)
  return data.form
}

export async function createForm(payload: Partial<PactForm>): Promise<PactForm> {
  const data = await request<{ form: PactForm }>('/forms', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.form
}

export async function updateForm(id: string, payload: Partial<PactForm>): Promise<PactForm> {
  const data = await request<{ form: PactForm }>(`/forms/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return data.form
}

export async function publishForm(id: string, contract_address: string, chain_id?: number): Promise<void> {
  await request(`/forms/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ contract_address, chain_id }),
  })
}

export async function deleteForm(id: string): Promise<void> {
  await request(`/forms/${id}`, { method: 'DELETE' })
}

export async function archiveForm(id: string): Promise<void> {
  await request(`/forms/${id}/archive`, { method: 'POST', body: JSON.stringify({ action: 'archive' }) })
}

export async function unarchiveForm(id: string): Promise<void> {
  await request(`/forms/${id}/archive`, { method: 'POST', body: JSON.stringify({ action: 'restore' }) })
}

export async function getFormResponses(id: string): Promise<Submission[]> {
  const data = await request<{ responses: Submission[] }>(`/forms/${id}/responses`)
  return data.responses
}

// ---------------------------------------------------------------------------
// Submissions / Authorization
// ---------------------------------------------------------------------------

export async function startSubmission(
  formId: string,
  payer_address: string,
  answers: Record<string, unknown>
): Promise<StartSubmissionResponse> {
  return request<StartSubmissionResponse>(`/forms/${formId}/start-submission`, {
    method: 'POST',
    body: JSON.stringify({ payer_address, answers }),
  })
}

export async function confirmSubmission(formId: string, submission_id: string, tx_hash: string): Promise<void> {
  await request(`/forms/${formId}/confirm-submission`, {
    method: 'POST',
    body: JSON.stringify({ submission_id, tx_hash }),
  })
}

export async function submitFreeForm(
  formId: string,
  submitter_address: string | undefined,
  answers: Record<string, unknown>
): Promise<{ ok: boolean; submission_id?: string }> {
  const res = await fetch(`/api/forms/${formId}/submit-free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submitter_address, answers }),
  })
  const data = await res.json() as { ok?: boolean; submission_id?: string; error?: string }
  if (res.status === 409) throw new Error('Already submitted')
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as { ok: boolean; submission_id?: string }
}

// ---------------------------------------------------------------------------
// Creator dashboard
// ---------------------------------------------------------------------------

export async function getCreatorForms(address: string): Promise<PactForm[]> {
  const data = await request<{ forms: PactForm[] }>(`/forms/creator/${address}`)
  return data.forms
}

// ---------------------------------------------------------------------------
// Respondent dashboard
// ---------------------------------------------------------------------------

export async function getRespondentSubmissions(address: string): Promise<{ forms: RespondentSubmission[] }> {
  return request<{ forms: RespondentSubmission[] }>(`/forms/respondent/${address}`)
}

// ---------------------------------------------------------------------------
// AI form generation
// ---------------------------------------------------------------------------

export interface AiFormDraft {
  title: string
  description: string
  confirmation_message: string
  questions: import('./types').Question[]
  payment_mode?: import('./types').PaymentMode
  price_usdc?: string
  goal_count?: number
  capacity?: number
  deadline_ts?: number
  splits_equal?: boolean
  style_accent?: string
}

export async function generateFormWithAI(prompt: string, apiKey?: string): Promise<AiFormDraft> {
  const data = await request<{ form: AiFormDraft }>('/ai/generate-form', {
    method: 'POST',
    body: JSON.stringify({ prompt, apiKey }),
  })
  return data.form
}

export async function seedDemo(): Promise<{ form_id: string; already_seeded?: boolean }> {
  return request('/seed-demo', { method: 'POST' })
}
