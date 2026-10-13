
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body' },
      { status: 400 },
    );
  }

  if (!process.env.API_URL) {
    return NextResponse.json(
      { message: 'Registration service is not configured' },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(
      `${process.env.API_URL}/users/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    );

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Unable to connect to the registration service' },
      { status: 502 },
    );
  }
}
