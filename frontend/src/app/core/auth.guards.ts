import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, Role } from './auth.service';

// Route guards are UX only: they stop the wrong PAGE from opening. They do not
// protect data; the server's verifyToken/requireRole do that on every request.

// Only for a specific role; anyone else is sent to their own home page.
export function roleGuard(role: Role): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isLoggedIn()) {
      return router.createUrlTree(['/login']);
    }
    if (auth.role() !== role) {
      return router.createUrlTree([auth.homeFor(auth.role())]);
    }
    return true;
  };
}

// For login/register: an already logged-in user goes straight to their home.
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree([auth.homeFor(auth.role())]) : true;
};
