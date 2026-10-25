import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export type Role = 'applicant' | 'admin';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role;
  contactNumber?: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  contactNumber?: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = 'iem_token';
const USER_KEY = 'iem_user';

// Holds the logged-in session: the JWT (sent on every API call by the
// interceptor) and the user returned by the server (used only to decide what
// to SHOW). Anything here can be edited in the browser's dev tools, which is
// why the server re-checks the token and role on every request.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  readonly user = signal<User | null>(readStoredUser());
  readonly role = computed(() => this.user()?.role ?? null);

  getToken(): string | null {
    return this.token();
  }

  // A method, not a computed signal, so token expiry is re-checked each call.
  isLoggedIn(): boolean {
    const token = this.token();
    return !!token && !isExpired(token);
  }

  login(email: string, password: string): Observable<User> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap((res) => this.saveSession(res)), map((res) => res.user));
  }

  register(data: RegisterData): Observable<User> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/register`, data)
      .pipe(tap((res) => this.saveSession(res)), map((res) => res.user));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.token.set(null);
    this.user.set(null);
    this.router.navigate(['/login']);
  }

  homeFor(role: Role | null): string {
    return role === 'admin' ? '/admin' : '/dashboard';
  }

  private saveSession({ token, user }: AuthResponse): void {
    // localStorage keeps the session across page reloads. Trade-off: any script
    // on the page can read it; acceptable for a POC, httpOnly cookies are safer.
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.token.set(token);
    this.user.set(user);
  }
}

function readStoredUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

// Reads the token's "exp" claim. Purely so the UI doesn't pretend an expired
// session is still active; the server is what actually rejects it.
function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
