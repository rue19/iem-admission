import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { Application, ApplicationStatus, FeeRecord, UploadedDocument } from './models';

// In admin responses the applicant reference is populated with contact details.
export interface AdminApplication extends Omit<Application, 'applicant'> {
  applicant: { _id: string; name: string; email: string; contactNumber?: string };
}

export interface ApplicationDetail {
  application: AdminApplication;
  documents: UploadedDocument[];
  feeRecord: FeeRecord | null;
  allowedNextStatuses: ApplicationStatus[]; // straight from the server's workflow map
}

export interface ApplicationFilters {
  status?: string;
  course?: string;
  q?: string;
}

// Calls to /api/admin/*. The server rejects all of them unless the token's
// role is admin; the route guard only stops the PAGE opening.
@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/admin`;

  list(filters: ApplicationFilters): Observable<AdminApplication[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params = params.set(key, value);
    }
    return this.http
      .get<{ applications: AdminApplication[] }>(`${this.api}/applications`, { params })
      .pipe(map((r) => r.applications));
  }

  get(id: string): Observable<ApplicationDetail> {
    return this.http.get<ApplicationDetail>(`${this.api}/applications/${id}`);
  }

  updateStatus(id: string, status: ApplicationStatus) {
    return this.http.patch<{ application: AdminApplication; allowedNextStatuses: ApplicationStatus[] }>(
      `${this.api}/applications/${id}/status`,
      { status }
    );
  }

  setEntranceScore(id: string, entranceScore: number): Observable<AdminApplication> {
    return this.http
      .patch<{ application: AdminApplication }>(`${this.api}/applications/${id}/entrance-score`, { entranceScore })
      .pipe(map((r) => r.application));
  }

  // Fetched through HttpClient (not a plain link) so the interceptor can add
  // the token; the file comes back as a Blob.
  documentFile(documentId: string): Observable<Blob> {
    return this.http.get(`${this.api}/documents/${documentId}/file`, { responseType: 'blob' });
  }
}
