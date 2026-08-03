import { NextResponse } from 'next/server'
import { findPaymentByReference } from '@/lib/payments-store'
import { authorizePayment } from '@/lib/payseed'

export const dynamic = 'force-dynamic'

interface Body {
  reference?: string
  otp?: string
}

/**
 * Ghana MoMo OTP step: the customer enters the SMS code on our page and we
 * authorize the charge with PaySeed (POST /v1/payments/{id}/authorize). On
 * success the collection proceeds and the UI polls /payseed/status — which is
 * the only path that actually credits, and only after re-verifying success.
 */
export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const reference = (body.reference ?? '').trim()
  const otp = (body.otp ?? '').replace(/\D/g, '')
  if (!reference) return NextResponse.json({ error: 'reference required' }, { status: 400 })
  if (!otp) {
    return NextResponse.json({ error: 'Enter the code sent to your phone.' }, { status: 400 })
  }

  const pending = await findPaymentByReference(reference)
  if (!pending) return NextResponse.json({ error: 'unknown reference' }, { status: 404 })
  if (pending.status === 'success') {
    return NextResponse.json({ status: 'already-credited' }, { status: 200 })
  }

  const payseedId =
    typeof pending.metadata?.payseedId === 'string' ? pending.metadata.payseedId : ''
  if (!payseedId) {
    return NextResponse.json(
      { status: 'failed', error: 'payment context lost — please start again' },
      { status: 200 },
    )
  }

  let result
  try {
    result = await authorizePayment(payseedId, otp)
  } catch (e) {
    console.error('[payseed/otp] authorize failed:', e)
    // PaySeed rejects a wrong/expired code with a non-2xx — let the user retry.
    return NextResponse.json(
      { status: 'otp-invalid', error: 'Incorrect or expired code. Please try again.' },
      { status: 200 },
    )
  }

  if (result.status === 'failed' || result.status === 'reversed') {
    return NextResponse.json(
      { status: 'failed', error: 'Payment could not be completed.' },
      { status: 200 },
    )
  }

  // Accepted — the collection is in flight (or already success); the UI polls
  // /payseed/status, which re-verifies and credits.
  return NextResponse.json({ status: 'pending', reference }, { status: 200 })
}
