import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// Runs on every HttpClient request, so components never have to remember to
// add the token themselves.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  // Only attach the token to OUR API, never to third-party URLs.
  const isApiCall = req.url.startsWith(environment.apiUrl);
  const authReq =
    token && isApiCall ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      // Server says the token is missing/invalid/expired: drop the stale
      // session and send the user to login. A 401 from the login form itself
      // just means "wrong password", so leave that for the form to show.
      if (err.status === 401 && isApiCall && !req.url.endsWith('/auth/login')) {
        auth.logout();
      }
      return throwError(() => err);
    })
  );
};
