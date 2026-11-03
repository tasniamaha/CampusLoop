import { NextRequest, NextResponse } from 'next/server';
import { forwardedForHeader } from '../../../../lib/client-ip';
import { isBackendSession, setSessionCookies } from '../../../../lib/session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${process.env.API_URL}/auth/login`, {
      method: 'POST',
      headers: {
       'Content-Type': 'application/json',
        'User-Agent': request.headers.get('user-agent') ?? '',
        ...forwardedForHeader(request),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });


    const data: unknown = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, {
        status: response.status,
      });
    }
    if (!isBackendSession(data)) {
      return NextResponse.json({ message: 'Unexpected response from the authentication service' }, { status: 502 });
    }

    const result = NextResponse.json({
      user: data.user,
    });
    setSessionCookies(result, data);

    return result;
  } catch {
    return NextResponse.json(
      { message: 'Unable to connect to the authentication service' },
      { status: 502 },
    );
  }
}