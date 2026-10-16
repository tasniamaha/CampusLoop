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
    return NextResponse.json({ message: 'Service is not configured' }, { status: 500 });
  }
  try {
    const response = await fetch(`${process.env.API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedForHeader(request) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ message: 'Unable to connect to the service' }, { status: 502 });
  }
}