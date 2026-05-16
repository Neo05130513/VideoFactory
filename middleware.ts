import { NextRequest, NextResponse } from 'next/server';

const publicPaths = ['/login', '/register', '/pricing', '/change-password'];
const publicApiPrefixes = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.includes(pathname) || publicApiPrefixes.some((prefix) => pathname.startsWith(prefix)) || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const session = request.cookies.get('video_factory_session')?.value;
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname === '/change-password' || pathname.startsWith('/api/auth/change-password')) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
