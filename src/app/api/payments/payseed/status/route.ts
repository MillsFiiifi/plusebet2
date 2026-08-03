import { NextResponse } from 'next/server'
import { verifyAndCreditPayseed } from '@/lib/payseed-credit'

export const dynamic = 'force-dynamic'

// Poll target for the PaySeed deposit flow. Re-verifies the payment by its
// PaySeed id and credits on success (idempotent). Returns the current status so
// the frontend keeps polling ('pending'), stops on success, or shows a failure.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const reference = (searchParams.get('reference') ?? '').trim()
  if (!reference) {
    return NextResponse.json({ error: 'reference required' }, { status: 400 })
  }

  const result = await verifyAndCreditPayseed(reference)
  return NextResponse.json(result)
}
