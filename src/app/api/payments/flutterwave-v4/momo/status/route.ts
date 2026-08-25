import { NextResponse } from 'next/server'
import { verifyAndCreditFlutterwaveV4 } from '@/lib/flutterwave-v4-credit'

export const dynamic = 'force-dynamic'

// Poll target for the V4 MoMo checkout. Re-verifies the charge by our tx_ref
// and credits on success (idempotent). The frontend polls this while the
// customer approves the PIN prompt on their phone.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const reference = (searchParams.get('reference') ?? '').trim()
  if (!reference) {
    return NextResponse.json({ error: 'reference required' }, { status: 400 })
  }
  const result = await verifyAndCreditFlutterwaveV4(reference)
  return NextResponse.json(result)
}
