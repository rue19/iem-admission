import { Component, computed, input } from '@angular/core';
import { ApplicationStatus } from '../core/models';

// Coloured pill for an application status. Shared so the applicant dashboard
// and the admin review page show statuses the same way.
@Component({
  selector: 'app-status-badge',
  template: `<span class="status-badge" [class]="cssClass()">{{ status() }}</span>`,
  styles: `
    .status-badge { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .draft { background: #e5e7eb; color: #374151; }
    .submitted, .under-review { background: #dbeafe; color: #1e40af; }
    .approved { background: #dcfce7; color: #166534; }
    .rejected { background: #fee2e2; color: #991b1b; }
    .waitlisted { background: #fef3c7; color: #92400e; }
  `,
})
export class StatusBadge {
  readonly status = input.required<ApplicationStatus>();
  // "Under Review" -> "status-badge under-review"
  protected readonly cssClass = computed(
    () => `status-badge ${this.status().toLowerCase().replace(/\s+/g, '-')}`
  );
}
