import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';

// Placeholder so the admin redirect has somewhere to land.
// The real review screen is built in Phase 5.
@Component({
  selector: 'app-admin-review',
  template: `
    <section class="card">
      <h1>Administrator Review</h1>
      <p>Signed in as {{ auth.user()?.email }}. Application review arrives in Phase 5.</p>
    </section>
  `,
})
export class AdminReview {
  protected auth = inject(AuthService);
}
