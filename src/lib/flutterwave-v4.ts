// Flutterwave V4 — Ghana mobile money via the OAuth (client-credentials) API.
//
// Why V4: V4's GH MoMo uses a PIN PROMPT on the customer's phone
// (next_action = payment_instruction, "authorise on your mobile number"),
// NOT an OTP code — so it avoids the WhatsApp/SMS OTP entirely.
//
// Flow (all server-side):
//   1. OAuth: POST client_id+client_secret -> short-lived bearer token (10 min).
//   2. POST /customers        -> customer id  (cus_…)
//   3. POST /payment-methods  -> payment method id (pmd_…) for the MoMo number
//   4. POST /charges          -> charge id (chg_…), status 'pending',
//      next_action.payment_instruction. Customer approves with their PIN.
//   5. GET  /charges/{id}      -> poll until status 'succeeded' (paid).
//
// Amounts are MAJOR units (GH₵200 = 200). Credit ONLY on status 'succeeded'.

import { randomUUID } from 'crypto'

const IDP_TOKEN_URL =
  process.env.FLUTTERWAVE_V4_TOKEN_URL?.trim() ||
  'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token'
const V4_BASE =
  process.env.FLUTTERWAVE_V4_BASE_URL?.trim() || 'https://f4bexperience.flutterwave.com'

/** UI network id (mtn/vod/atl) -> V4 mobile_money network code. */
const NETWORK: Record<string, string> = {
  mtn: 'MTN',
  vod: 'VODAFONE', // Telecel Cash (formerly Vodafone)
  atl: 'AIRTELTIGO',
}

function getClientId(): string {
  const v = process.env.FLUTTERWAVE_V4_CLIENT_ID?.trim()
  if (!v) throw new Error('FLUTTERWAVE_V4_CLIENT_ID is not configured')
  return v
}
function getClientSecret(): string {
  const v = process.env.FLUTTERWAVE_V4_CLIENT_SECRET?.trim()
  if (!v) throw new Error('FLUTTERWAVE_V4_CLIENT_SECRET is not configured')
  return v
}

// Cache the bearer token across requests in this instance; refresh ~1 min early.
let _token: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (_token && _token.expiresAt - 60_000 > Date.now()) return _token.value
  const res = await fetch(IDP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error_description?: string
    error?: string
  }
  if (!res.ok || !body.access_token) {
    throw new Error(`FW v4 token failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`)
  }
  _token = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 600) * 1000,
  }
  return _token.value
}

interface V4Envelope<T> {
  status?: string
  message?: string
  error?: { message?: string; code?: string }
  data?: T
}

async function v4<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<T> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    // X-Trace-Id is REQUIRED by V4 (12–255 chars); unique per request.
    'X-Trace-Id': `pluse-${randomUUID()}`,
  }
  // V4 supports an idempotency key on POSTs so retries don't double-charge.
  if (init.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey
  const res = await fetch(`${V4_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as V4Envelope<T>
  if (!res.ok || (json.status && json.status !== 'success')) {
    const msg = json.error?.message ?? json.message ?? `HTTP ${res.status}`
    throw new Error(`FW v4 ${path}: ${msg}`)
  }
  if (json.data === undefined) throw new Error(`FW v4 ${path}: empty data`)
  return json.data
}

/** Normalise a Ghana number to the 9-digit local form V4 expects (no 0/233). */
function ghanaLocalNumber(phone: string): string {
  let d = (phone || '').replace(/\D/g, '')
  if (d.startsWith('233')) d = d.slice(3)
  d = d.replace(/^0+/, '')
  return d
}

/**
 * V4 rejects a customer whose email already exists ("CUSTOMER_ALREADY_EXISTS"),
 * and there's no reliable lookup, so we make the email unique PER CHARGE via
 * plus-addressing (routes to the same real inbox, never collides). Falls back
 * to a synthetic address if the email has no domain.
 */
function uniqueCustomerEmail(email: string, reference: string): string {
  const tag = reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)
  const at = (email || '').indexOf('@')
  if (at > 0) return `${email.slice(0, at)}+${tag}@${email.slice(at + 1)}`
  return `momo-${tag}@pluse.app`
}

export interface V4Charge {
  id: string
  status: string // 'pending' | 'succeeded' | 'failed' | …
  amount?: number
  currency?: string
  next_action?: {
    type?: string
    payment_instruction?: { note?: string }
  }
  processor_response?: { type?: string; code?: string }
}

/** Full GH MoMo charge: customer -> payment method -> charge. Returns the charge. */
export async function chargeGhanaMomoV4(input: {
  reference: string
  amount: number // major units
  email: string
  firstName: string
  lastName: string
  phone: string // as the user typed it (e.g. 0509182654)
  network: string // ui id: mtn | vod | atl
}): Promise<V4Charge> {
  const number = ghanaLocalNumber(input.phone)
  const netCode = NETWORK[input.network.toLowerCase()] ?? 'MTN'

  const customer = await v4<{ id: string }>('/customers', {
    method: 'POST',
    body: {
      name: { first: input.firstName || 'Customer', last: input.lastName || '' },
      phone: { country_code: '233', number },
      // Unique per charge so V4 never rejects a returning depositor.
      email: uniqueCustomerEmail(input.email, input.reference),
    },
  })

  const method = await v4<{ id: string }>('/payment-methods', {
    method: 'POST',
    body: {
      type: 'mobile_money',
      mobile_money: { country_code: '233', network: netCode, phone_number: number },
    },
  })

  const charge = await v4<V4Charge>('/charges', {
    method: 'POST',
    idempotencyKey: input.reference,
    body: {
      currency: 'GHS',
      amount: input.amount,
      reference: input.reference,
      customer_id: customer.id,
      payment_method_id: method.id,
    },
  })
  return charge
}

/** Authoritative status lookup by V4 charge id (chg_…). */
export async function getChargeV4(chargeId: string): Promise<V4Charge> {
  return v4<V4Charge>(`/charges/${encodeURIComponent(chargeId)}`, { method: 'GET' })
}

/** True only when the charge is fully paid. */
export function isChargePaid(c: V4Charge): boolean {
  return c.status === 'succeeded' || c.processor_response?.code === '00'
}
