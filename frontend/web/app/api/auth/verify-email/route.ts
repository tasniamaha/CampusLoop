import { NextRequest, NextResponse } from 'next/server';
import { forwardedForHeader } from '../../../../lib/client-ip';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }
  if (!process.env.API_URL) {
    return NextResponse.json({ message: 'Verification service is not configured' }, { status: 500 });
  }
  try {
    const response = await fetch(`${process.env.API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedForHeader(request) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ message: 'Unable to connect to the verification service' }, { status: 502 });
  }
}
