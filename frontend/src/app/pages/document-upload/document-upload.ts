import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApplicationService } from '../../core/application.service';
import { DocumentService, requiredDocumentsValid, REQUIRED_DOCUMENT_TYPES } from '../../core/document.service';
import { Application, DocumentType, UploadedDocument } from '../../core/models';
import { apiErrorMessage, apiErrorReasons } from '../../shared/api-error';
import { StatusBadge } from '../../shared/status-badge';

// Same numbers as the server's Rule DU, used only for an early hint.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'];

interface Slot {
  type: DocumentType;
  required: boolean;
  file: File | null; // chosen but not yet uploaded
  hint: string; // client-side heads-up; the server still decides
  uploading: boolean;
  error: string; // the server's message for the last upload attempt
}

@Component({
  selector: 'app-document-upload',
  imports: [RouterLink, StatusBadge],
  templateUrl: './document-upload.html',
  styleUrl: './document-upload.css',
})
export class DocumentUpload implements OnInit {
  private applications = inject(ApplicationService);
  private documentService = inject(DocumentService);

  protected readonly application = signal<Application | null>(null);
  protected readonly documents = signal<UploadedDocument[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly submitting = signal(false);
  protected readonly submitErrors = signal<string[]>([]);
  protected readonly submittedId = signal('');
  protected readonly slots = signal<Slot[]>(
    (['Identity Proof', 'Academic Certificate', 'Other'] as DocumentType[]).map((type) => ({
      type,
      required: REQUIRED_DOCUMENT_TYPES.includes(type),
      file: null,
      hint: '',
      uploading: false,
      error: '',
    }))
  );

  protected readonly isDraft = computed(() => this.application()?.status === 'Draft');
  protected readonly requiredValid = computed(() => requiredDocumentsValid(this.documents()));
  // Mirrors the server's submission gate so the button state is honest. The
  // server still re-checks everything when the button is pressed.
  protected readonly canSubmit = computed(
    () => this.isDraft() && !!this.application()?.course && this.requiredValid()
  );

  ngOnInit(): void {
    forkJoin({ app: this.applications.getMine(), docs: this.documentService.list() }).subscribe({
      next: ({ app, docs }) => {
        this.application.set(app);
        this.documents.set(docs);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  documentFor(type: DocumentType): UploadedDocument | undefined {
    return this.documents().find((d) => d.documentType === type);
  }

  onFileChosen(type: DocumentType, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    const ext = file?.name.split('.').pop()?.toLowerCase() ?? '';
    let hint = '';
    if (file && !ALLOWED_EXTENSIONS.includes(ext)) hint = 'This is not a PDF, JPG or PNG; the server will reject it.';
    else if (file && file.size > MAX_BYTES) hint = 'This file is over 5 MB; the server will reject it.';
    else if (file && file.size === 0) hint = 'This file is empty; the server will reject it.';
    this.patchSlot(type, { file, hint, error: '' });
  }

  upload(slot: Slot, picker: HTMLInputElement): void {
    if (!slot.file) return;
    this.patchSlot(slot.type, { uploading: true, error: '' });

    this.documentService.upload(slot.type, slot.file).subscribe({
      next: (doc) => {
        this.replaceDocument(doc);
        this.patchSlot(slot.type, { uploading: false, file: null, hint: '' });
        picker.value = ''; // clear the chooser so it doesn't look like a pending upload
      },
      error: (err: HttpErrorResponse) => {
        // A rejected file still comes back as an Invalid record, so the slot
        // shows the server's reason even after a page reload.
        if (err.error?.document) this.replaceDocument(err.error.document);
        this.patchSlot(slot.type, { uploading: false, error: apiErrorMessage(err) });
      },
    });
  }

  submit(): void {
    this.submitting.set(true);
    this.submitErrors.set([]);
    this.applications.submit().subscribe({
      next: ({ applicationId, application }) => {
        this.application.set(application);
        this.submittedId.set(applicationId);
        this.submitting.set(false);
      },
      error: (err) => {
        this.submitErrors.set(apiErrorReasons(err));
        this.submitting.set(false);
      },
    });
  }

  formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private replaceDocument(doc: UploadedDocument): void {
    this.documents.update((docs) => [...docs.filter((d) => d.documentType !== doc.documentType), doc]);
  }

  private patchSlot(type: DocumentType, changes: Partial<Slot>): void {
    this.slots.update((slots) => slots.map((s) => (s.type === type ? { ...s, ...changes } : s)));
  }
}
