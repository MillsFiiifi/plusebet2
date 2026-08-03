import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/payseed'
import { verifyAndCreditPayseed } from '@/lib/payseed-credit'

export const dynamic = 'force-dynamic'

/**
 * PaySeed webhook — server-to-server confirmation of payment events. We verify
 * the HMAC-SHA256 signature over the RAW body (X-PaySeed-Signature) before
 * trusting anything, then re-verify with PaySeed inside verifyAndCreditPayseed
 * (never credit off the webhook body alone). Idempotent: PaySeed retries up to
 * 10 times, and the markPaymentResolved gate makes duplicates harmless.
 *
 * Delivered events: payment.success, payment.reversed, payout.success,
 * payout.failed. We only act on payment.success here.
 */
export async function POST(request: Request) {
  // Raw bytes — re-serialising JSON would break signature verification.
  const rawBody = await request.text()
  const signature = request.headers.get('x-payseed-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: { event?: string; data?: { reference?: string; status?: string } }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const event = payload.event ?? request.headers.get('x-payseed-event') ?? ''
  const reference = (payload.data?.reference ?? '').trim()

  // Acknowledge non-payment / non-success events fast (2xx) — nothing to do.
  if (event !== 'payment.success' || !reference) {
    return NextResponse.json({ received: true }, { status: 200 })
  }

  try {
    const result = await verifyAndCreditPayseed(reference)
    console.log('[payseed/webhook] payment.success', { reference, result: result.status })
  } catch (e) {
    // Still 2xx so PaySeed doesn't hammer retries; the status poll + reconcile
    // are the safety net if this errored transiently.
    console.error('[payseed/webhook] credit failed:', e)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
