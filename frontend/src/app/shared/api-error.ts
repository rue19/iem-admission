import { HttpErrorResponse } from '@angular/common/http';

// Turns any failed HTTP call into one sentence to show the user. The API always
// replies { error: "..." }; status 0 means the request never reached it.
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Is the back end running on port 3000?';
    if (typeof err.error?.error === 'string') return err.error.error;
  }
  return 'Something went wrong. Please try again.';
}
