
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL;

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('campusloop_token')?.value;

  if (!token || !API_URL) {
    return null;
  }

  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}
