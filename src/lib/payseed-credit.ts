// Shared verify-then-credit pipeline for PaySeed deposits.
//
// Used by:
//   - /api/payments/payseed/status   (POST/GET poll while the customer pays)
//   - /api/payments/payseed/webhook  (server-to-server, signed)
//
// Idempotent on our reference. We always re-verify via GET /v1/payments/{id}
// and credit ONLY when data.status === 'success' with a matching amount +
// currency. The atomic markPaymentResolved gate guarantees exactly one path
// runs applyDepositCredit, so the webhook and the poll can't double-credit.

import { findPaymentByReference, markPaymentResolved } from '@/lib/payments-store'
import { getPayment } from '@/lib/payseed'
import { applyDepositCredit } from '@/lib/deposit-credit'

export type PayseedCreditStatus =
  | 'success'
  | 'already-credited'
  | 'missing-reference'
  | 'unknown-reference'
  | 'missing-payseed-id'
  | 'verify-failed'
  | 'amount-mismatch'
  | 'currency-mismatch'
  | 'no-user'
  | 'credit-failed'
  | string // pass-through for non-success PaySeed statuses (failed/pending/…)

export interface PayseedCreditResult {
  status: PayseedCreditStatus
  ok: boolean
  reference: string
}

export async function verifyAndCreditPayseed(
  ref: string,
): Promise<PayseedCreditResult> {
  const reference = (ref ?? '').trim()
  if (!reference) return { status: 'missing-reference', ok: false, reference }

  const pending = await findPaymentByReference(reference)
  if (!pending) return { status: 'unknown-reference', ok: false, reference }
  if (pending.status === 'success') {
    return { status: 'already-credited', ok: true, reference }
  }

  // We stored PaySeed's payment id on the pending row at /start.
  const payseedId =
    typeof pending.metadata?.payseedId === 'string' ? pending.metadata.payseedId : ''
  if (!payseedId) return { status: 'missing-payseed-id', ok: false, reference }

  let tx
  try {
    tx = await getPayment(payseedId)
  } catch (e) {
    console.error('[payseed-credit] verify failed:', e)
    return { status: 'verify-failed', ok: false, reference }
  }

  if (tx.status !== 'success') {
    return { status: tx.status, ok: false, reference }
  }

  // Guard against a tampered/mismatched charge before crediting.
  const paid = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount)
  if (!Number.isFinite(paid) || paid + 0.01 < pending.amount) {
    console.error('[payseed-credit] amount mismatch', {
      reference,
      pendingAmount: pending.amount,
      paidAmount: paid,
    })
    return { status: 'amount-mismatch', ok: false, reference }
  }
  if (tx.currency && pending.currency && tx.currency !== pending.currency) {
    console.error('[payseed-credit] currency mismatch', {
      reference,
      pendingCurrency: pending.currency,
      paidCurrency: tx.currency,
    })
    return { status: 'currency-mismatch', ok: false, reference }
  }

  if (!pending.userId) {
    console.error('[payseed-credit] missing userId on pending row', reference)
    return { status: 'no-user', ok: false, reference }
  }

  try {
    const resolved = await markPaymentResolved(pending.id, 'payseed auto-verify')
    if (!resolved) {
      // The webhook and the poll raced — the other one already credited.
      return { status: 'already-credited', ok: true, reference }
    }
    await applyDepositCredit(pending.userId, pending.amount, { reference })
  } catch (e) {
    console.error('[payseed-credit] credit pipeline failed:', e)
    return { status: 'credit-failed', ok: false, reference }
  }

  return { status: 'success', ok: true, reference }
}
