import { NextResponse } from 'next/server'
import { findUserById } from '@/lib/users-store'
import { recordPayment } from '@/lib/payments-store'
import { chargeGhanaMomoV4 } from '@/lib/flutterwave-v4'
import { getMinFirstDeposit } from '@/lib/countries'

export const dynamic = 'force-dynamic'

interface Body {
  userId?: string
  amount?: number
  phone?: string
  network?: string // mtn | vod | atl
}

/**
 * Ghana MoMo deposit via Flutterwave V4. Creates the charge (customer ->
 * payment method -> charge) and writes a pending row keyed on our tx_ref, with
 * the V4 charge id stashed in metadata for the status poll. V4 authorises with
 * a PIN PROMPT on the phone (no OTP) — the frontend just polls until paid.
 */
export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const userId = (body.userId ?? '').trim()
  const amount = Number(body.amount)
  const phone = (body.phone ?? '').trim()
  const network = (body.network ?? '').toLowerCase()

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }
  if (!phone) return NextResponse.json({ error: 'mobile money number required' }, { status: 400 })
  if (!['mtn', 'vod', 'atl'].includes(network)) {
    return NextResponse.json({ error: 'pick a valid network' }, { status: 400 })
  }

  const user = await findUserById(userId)
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })
  if (user.currency !== 'GHS') {
    return NextResponse.json({ error: 'mobile money is Ghana-only' }, { status: 400 })
  }

  const minDeposit = getMinFirstDeposit(user.country)
  if (amount < minDeposit) {
    return NextResponse.json(
      { error: `minimum deposit is ${user.currency} ${minDeposit.toFixed(2)}` },
      { status: 400 },
    )
  }

  const txRef = `FW4-DEP-${userId.slice(0, 8)}-${Date.now()}`
  const [firstName, ...rest] = (user.name || 'Customer').trim().split(/\s+/)
  const lastName = rest.join(' ')
  const email = user.email?.trim() || `customer+${userId}@pluse.app`

  let charge
  try {
    charge = await chargeGhanaMomoV4({
      reference: txRef,
      amount,
      email,
      firstName,
      lastName,
      phone,
      network,
    })
  } catch (e) {
    console.error('[flutterwave-v4/momo/start] charge failed:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'flutterwave v4 charge failed' },
      { status: 502 },
    )
  }

  try {
    await recordPayment({
      userId,
      reference: txRef,
      amount,
      type: 'deposit',
      status: 'pending',
      provider: 'flutterwave',
      currency: user.currency,
      metadata: {
        flow: 'momo-v4',
        chargeId: charge.id,
        network: body.network,
        purpose: 'deposit',
        userName: user.name,
        userPhone: phone,
      },
    })
  } catch (e) {
    console.error('[flutterwave-v4/momo/start] pending ledger write failed:', e)
  }

  return NextResponse.json(
    {
      reference: txRef,
      status: charge.status,
      // "Please authorise this payment on your mobile number: …" — shown to the
      // customer so they know to approve the PIN prompt on their phone.
      instruction: charge.next_action?.payment_instruction?.note ?? null,
    },
    { status: 201 },
  )
}
