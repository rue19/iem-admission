import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminApplication, AdminService, ApplicationDetail, DashboardCounts } from '../../core/admin.service';
import { ApplicationService } from '../../core/application.service';
import { ConfigService } from '../../core/config.service';
import { requiredDocumentsValid } from '../../core/document.service';
import { APPLICATION_STATUSES, ApplicationStatus, Course, UploadedDocument } from '../../core/models';
import { apiErrorMessage } from '../../shared/api-error';
import { StatusBadge } from '../../shared/status-badge';

// Statuses in which the server accepts an entrance score (mirrored for UX).
const SCORABLE: ApplicationStatus[] = ['Submitted', 'Under Review', 'Waitlisted'];

@Component({
  selector: 'app-admin-review',
  imports: [ReactiveFormsModule, DatePipe, StatusBadge],
  templateUrl: './admin-review.html',
  styleUrl: './admin-review.css',
})
export class AdminReview implements OnInit {
  private admin = inject(AdminService);
  private applications = inject(ApplicationService);
  private config = inject(ConfigService);
  private fb = inject(NonNullableFormBuilder);

  protected readonly statuses = APPLICATION_STATUSES;
  protected readonly courses = signal<Course[]>([]);

  // Top block: counts from the aggregation pipeline, using the same
  // status/course filters as the list.
  protected readonly counts = signal<DashboardCounts | null>(null);
  protected readonly countsError = signal('');

  // Left column: search results.
  protected readonly filters = this.fb.group({ q: [''], status: [''], course: [''] });
  protected readonly results = signal<AdminApplication[]>([]);
  protected readonly listLoading = signal(false);
  protected readonly listError = signal('');

  // Right column: the selected application.
  protected readonly detail = signal<ApplicationDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly actionError = signal('');
  protected readonly actionMessage = signal('');
  protected readonly saving = signal(false);
  // "Information verified" is the reviewer's own tick: UX only, not stored.
  protected readonly infoVerified = signal(false);

  protected readonly scoreForm = this.fb.group({
    entranceScore: [null as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
  });
  protected readonly nextStatus = signal<ApplicationStatus | ''>('');

  protected readonly allowed = computed(() => this.detail()?.allowedNextStatuses ?? []);
  protected readonly canApprove = computed(() => this.allowed().includes('Approved'));
  protected readonly canReject = computed(() => this.allowed().includes('Rejected'));
  // "Update Status" covers the non-decision moves (Under Review, Waitlisted).
  protected readonly otherMoves = computed(() =>
    this.allowed().filter((s) => s !== 'Approved' && s !== 'Rejected')
  );
  protected readonly docsValid = computed(() => requiredDocumentsValid(this.detail()?.documents ?? []));
  protected readonly canScore = computed(() => SCORABLE.includes(this.detail()?.application.status as ApplicationStatus));

  ngOnInit(): void {
    this.applications.getCourses().subscribe({ next: (c) => this.courses.set(c) });
    this.search();
  }

  search(): void {
    this.loadCounts();
    this.listLoading.set(true);
    this.listError.set('');
    this.admin.list(this.filters.getRawValue()).subscribe({
      next: (apps) => {
        this.results.set(apps);
        this.listLoading.set(false);
      },
      error: (err) => {
        this.listError.set(apiErrorMessage(err));
        this.listLoading.set(false);
      },
    });
  }

  loadCounts(): void {
    const { status, course } = this.filters.getRawValue();
    this.admin.dashboard({ status, course }).subscribe({
      next: (c) => {
        this.counts.set(c);
        this.countsError.set('');
      },
      error: (err) => this.countsError.set(apiErrorMessage(err)),
    });
  }

  // Share of the total, for the bar widths.
  percentOf(count: number): number {
    const total = this.counts()?.total ?? 0;
    return total ? Math.round((count / total) * 100) : 0;
  }

  clearFilters(): void {
    this.filters.reset();
    this.search();
  }

  select(id: string): void {
    this.detailLoading.set(true);
    this.actionError.set('');
    this.actionMessage.set('');
    this.infoVerified.set(false);
    this.admin.get(id).subscribe({
      next: (d) => {
        this.showDetail(d);
        this.detailLoading.set(false);
      },
      error: (err) => {
        this.actionError.set(apiErrorMessage(err));
        this.detailLoading.set(false);
      },
    });
  }

  changeStatus(status: ApplicationStatus | ''): void {
    const current = this.detail();
    if (!current || !status) return;
    this.saving.set(true);
    this.actionError.set('');
    this.admin.updateStatus(current.application._id, status).subscribe({
      next: ({ application, allowedNextStatuses }) => {
        this.showDetail({ ...current, application, allowedNextStatuses });
        this.patchResult(application);
        this.loadCounts(); // the status counts just changed
        this.actionMessage.set(`Status changed to ${application.status}.`);
        this.saving.set(false);
      },
      error: (err) => {
        // e.g. 409 if another admin changed it first: reload the real state.
        this.actionError.set(apiErrorMessage(err));
        this.saving.set(false);
        this.select(current.application._id);
      },
    });
  }

  saveScore(): void {
    const current = this.detail();
    if (!current || this.scoreForm.invalid) {
      this.scoreForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.actionError.set('');
    const score = Number(this.scoreForm.getRawValue().entranceScore);
    this.admin.setEntranceScore(current.application._id, score).subscribe({
      next: () => {
        // Re-fetch so the server's new eligibility verdict is shown too, but
        // keep the reviewer's "Information verified" tick.
        const verified = this.infoVerified();
        this.select(current.application._id);
        this.infoVerified.set(verified);
        this.actionMessage.set(`Entrance score recorded: ${score}. Merit score recalculated.`);
        this.saving.set(false);
      },
      error: (err) => {
        this.actionError.set(apiErrorMessage(err));
        this.saving.set(false);
      },
    });
  }

  viewDocument(doc: UploadedDocument): void {
    // Open the tab now, inside the click, so pop-up blockers allow it; fill it
    // once the file (or its signed link) has arrived.
    const tab = window.open('', '_blank');
    const fail = (err: unknown) => {
      tab?.close();
      this.actionError.set(apiErrorMessage(err));
    };

    this.config.config$.subscribe(({ uploadMode }) => {
      if (uploadMode === 'blob') {
        // Vercel: the file goes from Blob straight to the browser.
        this.admin.documentLink(doc._id).subscribe({
          next: ({ url }) => {
            if (tab) tab.location.href = url;
          },
          error: fail,
        });
        return;
      }
      this.admin.documentFile(doc._id).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          if (tab) tab.location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: fail,
      });
    });
  }

  private showDetail(d: ApplicationDetail): void {
    this.detail.set(d);
    this.nextStatus.set('');
    this.scoreForm.reset({ entranceScore: d.application.entranceScore });
  }

  // Keep the left-hand list in step with a change made on the right.
  private patchResult(app: AdminApplication): void {
    this.results.update((list) => list.map((a) => (a._id === app._id ? app : a)));
  }
}
