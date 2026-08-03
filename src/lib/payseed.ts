// PaySeed API client — the gateway layer for Ghana (mobile money) and Nigeria
// (bank transfer / card). Our server talks to PaySeed; PaySeed talks to the
// licensed provider. See https://payseed-api-production.up.railway.app docs.
//
// Flow (API-driven, mirrors the Flutterwave GH MoMo pattern):
//   1. /api/payments/payseed/start  → POST /v1/payments, write a pending row
//      keyed on OUR reference, store PaySeed's payment id in metadata.
//   2. Ghana MoMo: if PaySeed asks for an OTP, the customer enters it on our
//      page → /api/payments/payseed/otp → POST /v1/payments/{id}/authorize.
//      Otherwise they approve the phone prompt.
//   3. /api/payments/payseed/status re-verifies via GET /v1/payments/{id} and
//      credits ONLY when data.status === 'success' (idempotent).
//   4. Defence-in-depth: PaySeed POSTs a signed webhook to
//      /api/payments/payseed/webhook (X-PaySeed-Signature, HMAC-SHA256).
//
// Amounts are MAJOR units (₦1000 = 1000, GH₵1000 = 1000), like Flutterwave.
// Trust only data.status === 'success' — never assume from the init reply.
//
// NOTE: PaySeed's public docs specify the NG virtual_account request cleanly but
// are light on the exact Ghana-MoMo field names. The GH-specific bits (the
// `channel` value and the network/provider field) are centralised in the two
// constants below so they're a one-line fix once verified against the test API.

import { createHmac, timingSafeEqual } from 'crypto'
import type { CurrencyCode } from '@/lib/countries'

const PAYSEED_BASE =
  process.env.PAYSEED_BASE_URL?.trim() ||
  'https://payseed-api-production.up.railway.app'

/** PaySeed channel to use for each rail. */
export const PAYSEED_CHANNEL = {
  ghanaMomo: 'mobile_money',
  nigeriaBank: 'virtual_account',
  card: 'card',
} as const

/** UI network id (mtn/vod/atl) → PaySeed mobile-money provider code. */
const MOMO_PROVIDER: Record<string, string> = {
  mtn: 'mtn',
  vod: 'vodafone', // Telecel Cash (formerly Vodafone Cash)
  atl: 'airteltigo',
}

function getSecretKey(): string {
  const key = process.env.PAYSEED_SECRET_KEY?.trim()
  if (!key) throw new Error('PAYSEED_SECRET_KEY is not configured')
  return key
}

function getWebhookSecret(): string | null {
  return process.env.PAYSEED_WEBHOOK_SECRET?.trim() || null
}

/** PaySeed wraps every reply as { success, data } or { success:false, error }. */
interface PaySeedEnvelope<T> {
  success: boolean
  data?: T
  error?: { code?: string; message?: string }
}

export type PaySeedStatus = 'success' | 'pending' | 'failed' | 'reversed' | string

/** A payment object as PaySeed returns it (fields read defensively). */
export interface PaySeedPayment {
  id: string
  reference: string
  status: PaySeedStatus
  amount: number
  currency: string
  channel?: string
  /** Set when the MoMo charge needs an SMS OTP before it can proceed. */
  requires_otp?: boolean
  /** Off-site page (card / some bank flows) the customer must complete. */
  checkout_url?: string
  redirect_url?: string
  /** Bank-transfer (NG virtual_account) details to show the customer. */
  account?: {
    bank_name?: string
    account_number?: string
    account_name?: string
    expires_at?: string
  }
  [key: string]: unknown
}

async function call<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string },
): Promise<PaySeedEnvelope<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getSecretKey()}`,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
  const res = await fetch(`${PAYSEED_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => ({}))) as PaySeedEnvelope<T>
  if (!res.ok || body.success === false) {
    const msg = body.error?.message ?? `HTTP ${res.status}`
    throw new Error(`PaySeed ${path}: ${msg}`)
  }
  return body
}

export interface CreatePaymentInput {
  amount: number // major units
  currency: CurrencyCode
  reference: string
  channel: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  /** UI network id (mtn/vod/atl) for Ghana MoMo. */
  network?: string
  redirectUrl?: string
}

/**
 * Initialise a payment. Returns PaySeed's payment object — read `id`, `status`,
 * `requires_otp`, `checkout_url`/`redirect_url`, or `account` off it depending
 * on the channel. Idempotent on our reference via the Idempotency-Key header.
 */
export async function createPayment(input: CreatePaymentInput): Promise<PaySeedPayment> {
  const provider = input.network ? MOMO_PROVIDER[input.network.toLowerCase()] : undefined
  const body: Record<string, unknown> = {
    amount: input.amount,
    currency: input.currency,
    reference: input.reference,
    channel: input.channel,
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      ...(input.customerPhone ? { phone: input.customerPhone } : {}),
    },
    ...(provider ? { provider } : {}),
    ...(input.customerPhone ? { phone: input.customerPhone } : {}),
    ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
  }
  const { data } = await call<PaySeedPayment>('/v1/payments', {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey: input.reference,
  })
  if (!data) throw new Error('PaySeed create: empty response')
  return data
}

/** Authoritative status lookup by PaySeed payment id. */
export async function getPayment(id: string): Promise<PaySeedPayment> {
  const { data } = await call<PaySeedPayment>(`/v1/payments/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
  if (!data) throw new Error('PaySeed get: empty response')
  return data
}

/** Submit the SMS OTP for a Ghana MoMo charge. */
export async function authorizePayment(id: string, otp: string): Promise<PaySeedPayment> {
  const { data } = await call<PaySeedPayment>(
    `/v1/payments/${encodeURIComponent(id)}/authorize`,
    { method: 'POST', body: JSON.stringify({ otp }) },
  )
  if (!data) throw new Error('PaySeed authorize: empty response')
  return data
}

/**
 * Verify a PaySeed webhook: HMAC-SHA256 of the RAW request body with the
 * whsec_… signing secret, compared to the X-PaySeed-Signature header. Always
 * pass the raw bytes — re-serialising JSON breaks the signature. Returns false
 * if the secret isn't configured or the signature doesn't match.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = getWebhookSecret()
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.trim())
  return a.length === b.length && timingSafeEqual(a, b)
}
