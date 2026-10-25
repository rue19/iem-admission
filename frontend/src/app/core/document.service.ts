import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { DocumentType, UploadedDocument } from './models';

export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = ['Identity Proof', 'Academic Certificate'];

// True when every required slot holds a document the SERVER marked Valid.
// Used to enable buttons only; submission re-checks this on the server.
export function requiredDocumentsValid(documents: UploadedDocument[]): boolean {
  return REQUIRED_DOCUMENT_TYPES.every((type) =>
    documents.some((d) => d.documentType === type && d.validationStatus === 'Valid')
  );
}

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/applications/me/documents`;

  // 404 = no application yet, so there are simply no documents.
  list(): Observable<UploadedDocument[]> {
    return this.http.get<{ documents: UploadedDocument[] }>(this.url).pipe(
      map((r) => r.documents),
      catchError((err: HttpErrorResponse) => (err.status === 404 ? of([]) : throwError(() => err)))
    );
  }

  // multipart/form-data: the browser sets the Content-Type (with its boundary)
  // itself, so we must not set it by hand.
  upload(documentType: DocumentType, file: File): Observable<UploadedDocument> {
    const body = new FormData();
    body.append('documentType', documentType);
    body.append('file', file);
    return this.http.post<{ document: UploadedDocument }>(this.url, body).pipe(map((r) => r.document));
  }
}
