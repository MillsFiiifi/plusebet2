// Verify-then-credit for Flutterwave V4 Ghana MoMo deposits.
//
// The pending payment row (written at /flutterwave-v4/momo/start) stores the V4
// charge id (chg_…) in metadata. We re-fetch the charge and credit the wallet
// ONLY when V4 reports it paid ('succeeded'). Idempotent via markPaymentResolved.

import { findPaymentByReference, markPaymentResolved } from '@/lib/payments-store'
import { getChargeV4, isChargePaid } from '@/lib/flutterwave-v4'
import { applyDepositCredit } from '@/lib/deposit-credit'

export interface FlwV4CreditResult {
  status: string
  ok: boolean
  reference: string
}

export async function verifyAndCreditFlutterwaveV4(txRef: string): Promise<FlwV4CreditResult> {
  const reference = (txRef ?? '').trim()
  if (!reference) return { status: 'missing-reference', ok: false, reference }

  const pending = await findPaymentByReference(reference)
  if (!pending) return { status: 'unknown-reference', ok: false, reference }
  if (pending.status === 'success') return { status: 'already-credited', ok: true, reference }

  const chargeId = typeof pending.metadata?.chargeId === 'string' ? pending.metadata.chargeId : ''
  if (!chargeId) return { status: 'no-charge-id', ok: false, reference }

  let charge
  try {
    charge = await getChargeV4(chargeId)
  } catch (e) {
    console.error('[flw-v4-credit] verify failed:', e)
    return { status: 'verify-failed', ok: false, reference }
  }

  if (!isChargePaid(charge)) return { status: charge.status ?? 'pending', ok: false, reference }

  // Guard the amount/currency before crediting.
  if (charge.currency && pending.currency && charge.currency !== pending.currency) {
    return { status: 'currency-mismatch', ok: false, reference }
  }
  if (typeof charge.amount === 'number' && charge.amount + 0.01 < pending.amount) {
    return { status: 'amount-mismatch', ok: false, reference }
  }
  if (!pending.userId) return { status: 'no-user', ok: false, reference }

  try {
    const resolved = await markPaymentResolved(pending.id, 'flutterwave-v4 auto-verify')
    if (!resolved) return { status: 'already-credited', ok: true, reference }
    await applyDepositCredit(pending.userId, pending.amount, { reference })
  } catch (e) {
    console.error('[flw-v4-credit] credit pipeline failed:', e)
    return { status: 'credit-failed', ok: false, reference }
  }
  return { status: 'success', ok: true, reference }
}
