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
