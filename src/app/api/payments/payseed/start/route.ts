import { NextResponse } from 'next/server'
import { findUserById } from '@/lib/users-store'
import { recordPayment, mergePaymentMetadata } from '@/lib/payments-store'
import { createPayment, PAYSEED_CHANNEL } from '@/lib/payseed'
import { getMinFirstDeposit } from '@/lib/countries'

export const dynamic = 'force-dynamic'

interface StartBody {
  userId?: string
  amount?: number
  phone?: string
  /** UI network id: mtn | vod | atl (Ghana MoMo only) */
  network?: string
  returnPath?: string
  purpose?: 'deposit' | 'verification'
}

function sanitizeReturnPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/account'
  return raw
}

function originFromRequest(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (host) {
    const proto =
      req.headers.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

/**
 * Start a PaySeed deposit. Ghana (GHS) uses mobile money (phone + network);
 * Nigeria (NGN) uses a bank-transfer virtual account. We write a pending row
 * keyed on OUR reference and stash PaySeed's payment id for later verification.
 * The frontend then either collects an OTP, shows bank details, redirects, or
 * polls — depending on what PaySeed returns.
 */
export async function POST(request: Request) {
  let body: StartBody
  try {
    body = (await request.json()) as StartBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const userId = (body.userId ?? '').trim()
  const amount = Number(body.amount)
  const phone = (body.phone ?? '').trim()
  const network = (body.network ?? '').toLowerCase()
  const purpose: 'deposit' | 'verification' =
    body.purpose === 'verification' ? 'verification' : 'deposit'
  const returnPath = sanitizeReturnPath(body.returnPath)

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }

  const user = await findUserById(userId)
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

  const isGhana = user.currency === 'GHS'
  if (isGhana && !phone) {
    return NextResponse.json({ error: 'mobile money number required' }, { status: 400 })
  }
  if (isGhana && !['mtn', 'vod', 'atl'].includes(network)) {
    return NextResponse.json({ error: 'pick a valid network' }, { status: 400 })
  }

  const minDeposit = getMinFirstDeposit(user.country)
  if (amount < minDeposit) {
    return NextResponse.json(
      { error: `minimum deposit is ${user.currency} ${minDeposit.toFixed(2)}` },
      { status: 400 },
    )
  }

  const refPrefix = purpose === 'verification' ? 'PS-VRF' : 'PS-DEP'
  const reference = `${refPrefix}-${userId.slice(0, 8)}-${Date.now()}`
  const channel = isGhana ? PAYSEED_CHANNEL.ghanaMomo : PAYSEED_CHANNEL.nigeriaBank
  const origin = originFromRequest(request)
  const redirectUrl = `${origin}${returnPath}?payseed=return&ref=${encodeURIComponent(reference)}`

  try {
    await recordPayment({
      userId,
      reference,
      amount,
      type: 'deposit',
      status: 'pending',
      provider: 'payseed',
      currency: user.currency,
      metadata: {
        purpose,
        flow: isGhana ? 'momo' : 'bank',
        channel,
        network: isGhana ? network : undefined,
        returnPath,
        userName: user.name,
        userPhone: phone || user.phone || null,
        country: user.country,
      },
    })
  } catch (e) {
    console.error('[payseed/start] pending ledger write failed:', e)
  }

  const customerEmail = user.email?.trim() || `customer+${userId}@pluse.app`

  try {
    const payment = await createPayment({
      amount,
      currency: user.currency,
      reference,
      channel,
      customerName: user.name,
      customerEmail,
      customerPhone: isGhana ? phone : (user.phone ?? undefined),
      network: isGhana ? network : undefined,
      redirectUrl,
    })

    // Persist PaySeed's payment id so status/webhook can re-verify by it.
    if (payment.id) {
      await mergePaymentMetadata(reference, { payseedId: String(payment.id) }).catch((e) =>
        console.error('[payseed/start] id stash failed:', e),
      )
    }

    return NextResponse.json(
      {
        reference,
        status: payment.status,
        // Ghana MoMo may need an SMS OTP entered on our page.
        otpRequired: payment.requires_otp === true,
        // Card / some flows hand off to a PaySeed-hosted page.
        redirect: payment.checkout_url ?? payment.redirect_url ?? null,
        // Nigeria bank transfer — show these details to the customer.
        account: payment.account ?? null,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('[payseed/start] create failed:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'payseed init failed' },
      { status: 502 },
    )
  }
}
