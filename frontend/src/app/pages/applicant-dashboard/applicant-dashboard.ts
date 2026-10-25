import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApplicationService } from '../../core/application.service';
import { AuthService } from '../../core/auth.service';
import { DocumentService, requiredDocumentsValid } from '../../core/document.service';
import { FeeService } from '../../core/fee.service';
import { Application, Course, FeeRecord, UploadedDocument } from '../../core/models';
import { apiErrorMessage, apiErrorReasons } from '../../shared/api-error';
import { StatusBadge } from '../../shared/status-badge';

@Component({
  selector: 'app-applicant-dashboard',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, CurrencyPipe, StatusBadge],
  templateUrl: './applicant-dashboard.html',
  styleUrl: './applicant-dashboard.css',
})
export class ApplicantDashboard implements OnInit {
  private applications = inject(ApplicationService);
  private documentService = inject(DocumentService);
  private feeService = inject(FeeService);
  protected auth = inject(AuthService);

  protected readonly courses = signal<Course[]>([]);
  protected readonly application = signal<Application | null>(null);
  protected readonly documents = signal<UploadedDocument[]>([]);
  protected readonly fee = signal<FeeRecord | null>(null);
  protected readonly busy = signal(false); // submit or pay in progress
  protected readonly actionErrors = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly editing = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');

  // Same limits the server enforces (0-100); shown instantly here for UX.
  protected readonly form = inject(NonNullableFormBuilder).group({
    course: ['', Validators.required],
    qualifyingPercent: [null as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
    sportsQuota: [false],
  });

  protected readonly isDraft = computed(() => this.application()?.status === 'Draft');
  // UX mirror of the server's submission gate.
  protected readonly canSubmit = computed(
    () => this.isDraft() && !this.editing() && requiredDocumentsValid(this.documents())
  );

  // Mirrors the server rule: editable when creating, or while still a Draft.
  protected readonly formOpen = computed(() => !this.application() || (this.isDraft() && this.editing()));

  protected readonly checklist = computed(() => {
    const app = this.application();
    return [
      { label: 'Application info completed', done: !!app },
      { label: 'Course selected', done: !!app?.course },
      { label: 'Required documents uploaded and valid', done: requiredDocumentsValid(this.documents()) },
      { label: 'Application submitted', done: !!app && app.status !== 'Draft' },
    ];
  });

  ngOnInit(): void {
    // Load the dropdown, the application and its documents in parallel.
    forkJoin({
      courses: this.applications.getCourses(),
      app: this.applications.getMine(),
      docs: this.documentService.list(),
      fee: this.feeService.getMine(),
    }).subscribe({
      next: ({ courses, app, docs, fee }) => {
        this.courses.set(courses);
        this.documents.set(docs);
        this.fee.set(fee);
        this.showApplication(app);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  startEdit(): void {
    this.message.set('');
    this.editing.set(true);
    this.form.enable();
  }

  cancelEdit(): void {
    this.showApplication(this.application());
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');

    const { course, qualifyingPercent, sportsQuota } = this.form.getRawValue();
    const input = { course, qualifyingPercent: Number(qualifyingPercent), sportsQuota };
    const request = this.application()
      ? this.applications.update(input)
      : this.applications.create(input);

    request.subscribe({
      next: (app) => {
        this.showApplication(app);
        this.message.set('Application saved as Draft.');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.saving.set(false);
      },
    });
  }

  submit(): void {
    this.busy.set(true);
    this.actionErrors.set([]);
    this.message.set('');
    this.applications.submit().subscribe({
      next: ({ applicationId, application, feeRecord }) => {
        this.showApplication(application);
        this.fee.set(feeRecord);
        this.message.set(`Application submitted. Application ID: ${applicationId}`);
        this.busy.set(false);
      },
      error: (err) => {
        this.actionErrors.set(apiErrorReasons(err));
        this.busy.set(false);
      },
    });
  }

  payFee(): void {
    this.busy.set(true);
    this.actionErrors.set([]);
    this.feeService.pay().subscribe({
      next: (fee) => {
        this.fee.set(fee);
        this.message.set(`Payment recorded (mock). Reference: ${fee.transactionRef}`);
        this.busy.set(false);
      },
      error: (err) => {
        this.actionErrors.set([apiErrorMessage(err)]);
        this.busy.set(false);
      },
    });
  }

  // "Track Status": re-fetch from the server, e.g. after an admin decision.
  refresh(): void {
    this.message.set('');
    forkJoin({ app: this.applications.getMine(), fee: this.feeService.getMine() }).subscribe({
      next: ({ app, fee }) => {
        this.showApplication(app);
        this.fee.set(fee);
        this.message.set('Status is up to date.');
      },
      error: (err) => this.error.set(apiErrorMessage(err)),
    });
  }

  private showApplication(app: Application | null): void {
    this.application.set(app);
    this.editing.set(false);
    if (app) {
      this.form.setValue({
        course: app.course._id,
        qualifyingPercent: app.qualifyingPercent,
        sportsQuota: app.sportsQuota,
      });
      this.form.disable();
    } else {
      this.form.enable();
    }
  }
}
