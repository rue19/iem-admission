import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../environments/environment';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('iem_token', 'header.e30.signature'); // payload "{}" = no expiry
    TestBed.configureTestingModule({
      providers: [
        // logout() navigates to /login, so the test router needs a route for it.
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('adds the Bearer token to calls to our API', () => {
    http.get(`${environment.apiUrl}/courses`).subscribe();
    const req = backend.expectOne(`${environment.apiUrl}/courses`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer header.e30.signature');
    req.flush({});
  });

  it('never sends the token to other sites', () => {
    http.get('https://example.com/data').subscribe();
    const req = backend.expectOne('https://example.com/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('clears the session when the API answers 401', () => {
    http.get(`${environment.apiUrl}/applications/me`).subscribe({ error: () => {} });
    backend.expectOne(`${environment.apiUrl}/applications/me`).flush({ error: 'expired' }, { status: 401, statusText: 'Unauthorized' });
    expect(localStorage.getItem('iem_token')).toBeNull();
  });

  it('keeps the session on a 401 from the login form (wrong password)', () => {
    http.post(`${environment.apiUrl}/auth/login`, {}).subscribe({ error: () => {} });
    backend.expectOne(`${environment.apiUrl}/auth/login`).flush({ error: 'bad' }, { status: 401, statusText: 'Unauthorized' });
    expect(localStorage.getItem('iem_token')).toBe('header.e30.signature');
  });
});
