import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { guestGuard, roleGuard } from './auth.guards';

// Builds a token-shaped string; guards only read its "exp" claim (UX check).
function fakeToken(expSecondsFromNow: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }));
  return `header.${payload}.signature`;
}

function login(role: 'applicant' | 'admin', expSecondsFromNow = 3600): void {
  localStorage.setItem('iem_token', fakeToken(expSecondsFromNow));
  localStorage.setItem('iem_user', JSON.stringify({ _id: '1', name: 'T', email: 't@example.com', role }));
}

function run(guard: ReturnType<typeof roleGuard>): boolean | string {
  const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));
  return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : (result as boolean);
}

describe('route guards (UX only; the server enforces access)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  it('roleGuard sends a logged-out visitor to /login', () => {
    expect(run(roleGuard('applicant'))).toBe('/login');
  });

  it('roleGuard lets the matching role through', () => {
    login('applicant');
    expect(run(roleGuard('applicant'))).toBe(true);
  });

  it('roleGuard sends an applicant who opens /admin to their own dashboard', () => {
    login('applicant');
    expect(run(roleGuard('admin'))).toBe('/dashboard');
  });

  it('roleGuard sends an admin who opens /dashboard to /admin', () => {
    login('admin');
    expect(run(roleGuard('applicant'))).toBe('/admin');
  });

  it('an expired token counts as logged out', () => {
    login('applicant', -60);
    expect(run(roleGuard('applicant'))).toBe('/login');
  });

  it('guestGuard sends a logged-in user away from login/register', () => {
    login('admin');
    expect(run(guestGuard)).toBe('/admin');
  });
});
