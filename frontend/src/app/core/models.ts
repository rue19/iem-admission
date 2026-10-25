// TypeScript shapes of the JSON the API returns. They give autocomplete and
// compile-time checks in Angular; they do NOT validate anything at runtime.

export type ApplicationStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'Waitlisted';

export interface Course {
  _id: string;
  courseName: string;
  eligibility: string;
  minQualifyingPercent: number;
}

export interface Application {
  _id: string;
  applicant: string;
  course: Course; // the API populates the course reference
  qualifyingPercent: number;
  entranceScore: number | null;
  sportsQuota: boolean;
  applicationDate: string;
  status: ApplicationStatus;
  meritScore: number | null;
  createdAt: string;
  updatedAt: string;
}

// What the applicant is allowed to send. No status: the server owns it.
export interface ApplicationInput {
  course: string;
  qualifyingPercent: number;
  sportsQuota: boolean;
}

export type DocumentType = 'Identity Proof' | 'Academic Certificate' | 'Other';

// Named UploadedDocument so it doesn't clash with the browser's global `Document`.
export interface UploadedDocument {
  _id: string;
  application: string;
  documentType: DocumentType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  validationStatus: 'Valid' | 'Invalid';
  validationMessage: string | null; // the server's reason when Invalid
  createdAt: string;
  updatedAt: string;
}

export interface FeeRecord {
  _id: string;
  application: string;
  amount: number;
  feeStatus: 'Pending' | 'Paid';
  createdDate: string;
  paidDate: string | null;
  transactionRef: string | null; // mock receipt number
}

export interface SubmitResult {
  applicationId: string;
  application: Application;
  feeRecord: FeeRecord;
}
