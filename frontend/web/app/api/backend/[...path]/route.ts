import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/client-ip';

const API_URL = process.env.API_URL;
const PASSED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options'] as const;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!API_URL) {
    return NextResponse.json({ message: 'API_URL is not configured on the frontend server.' }, { status: 500 });
  }

  const token = request.cookies.get('campusloop_token')?.value;
  if (!token) {
    return NextResponse.json({ message: 'Please log in to continue.' }, { status: 401 });
  }

  const { path } = await context.params;
  const target = `${API_URL.replace(/\/$/, '')}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  const clientIp = getClientIp(request);
  if (clientIp) headers.set('X-Forwarded-For', clientIp);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  try {
    const upstream = await fetch(target, { method, headers, body, cache: 'no-store' });
    const responseHeaders = new Headers();
    // Only these response headers pass through. content-disposition keeps a download's file name
    // (admin CSV exports); cache-control and nosniff keep the API's no-store and no-sniffing rules.
    for (const name of PASSED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ message: 'Unable to connect to the CampusLoop API.' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
