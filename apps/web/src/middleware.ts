import { NextRequest, NextResponse } from 'next/server';

/**
 * Visitors who aren't signed in see the landing page at / (the address stays /); signed-in people
 * get their home. `access` is the short-lived sign-in cookie; `sb_session` is a marker the API sets
 * for as long as the sign-in lasts (it holds nothing secret), so a returning person whose short-lived
 * cookie has expired still goes to the app, which renews it.
 */
export function middleware(req: NextRequest) {
  const signedIn = req.cookies.has('access') || req.cookies.has('sb_session');
  if (signedIn) return NextResponse.next();
  return NextResponse.rewrite(new URL('/welcome', req.url));
}

export const config = { matcher: ['/'] };
