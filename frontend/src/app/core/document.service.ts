import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, firstValueFrom, from, map, of, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';
import { DocumentType, UploadedDocument } from './models';

export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = ['Identity Proof', 'Academic Certificate'];
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'];

// True when every required slot holds a document the SERVER marked Valid.
// Used to enable buttons only; submission re-checks this on the server.
export function requiredDocumentsValid(documents: UploadedDocument[]): boolean {
  return REQUIRED_DOCUMENT_TYPES.every((type) =>
    documents.some((d) => d.documentType === type && d.validationStatus === 'Valid')
  );
}

// Same wording as the server's Rule DU message. Needed only for Blob uploads,
// where Vercel Blob itself refuses files over the limit that the server put
// in the upload token, so the API never sees them.
export function tooLargeMessage(sizeBytes: number): string {
  const mb = (sizeBytes / (1024 * 1024)).toFixed(6).replace(/\.?0+$/, '');
  return `File too large — maximum allowed size is 5 MB (your file is ${sizeBytes.toLocaleString('en-US')} bytes (${mb} MB))`;
}

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private config = inject(ConfigService);
  private url = `${environment.apiUrl}/applications/me/documents`;

  // 404 = no application yet, so there are simply no documents.
  list(): Observable<UploadedDocument[]> {
    return this.http.get<{ documents: UploadedDocument[] }>(this.url).pipe(
      map((r) => r.documents),
      catchError((err: HttpErrorResponse) => (err.status === 404 ? of([]) : throwError(() => err)))
    );
  }

  // Locally the file goes to the API in one request; on Vercel it goes
  // straight to Vercel Blob first (see uploadViaBlob).
  upload(documentType: DocumentType, file: File, applicationId: string): Observable<UploadedDocument> {
    return this.config.config$.pipe(
      switchMap((config) =>
        config.uploadMode === 'blob'
          ? from(this.uploadViaBlob(documentType, file, applicationId))
          : this.uploadViaApi(documentType, file)
      )
    );
  }

  // multipart/form-data: the browser sets the Content-Type (with its boundary)
  // itself, so we must not set it by hand.
  private uploadViaApi(documentType: DocumentType, file: File): Observable<UploadedDocument> {
    const body = new FormData();
    body.append('documentType', documentType);
    body.append('file', file);
    return this.http.post<{ document: UploadedDocument }>(this.url, body).pipe(map((r) => r.document));
  }

  // Vercel functions refuse request bodies over 4.5 MB, so on Vercel:
  // 1. the API checks the type and issues an upload token capped at 5 MB,
  // 2. the browser sends the file straight to Vercel Blob with that token,
  // 3. the API checks the stored file (real size, first bytes) and records it.
  private async uploadViaBlob(documentType: DocumentType, file: File, applicationId: string): Promise<UploadedDocument> {
    // Loaded only when needed, so local development never downloads it.
    const { upload } = await import('@vercel/blob/client');
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    // A random name, never the user's file name; the server checks this shape.
    const pathname = `applications/${applicationId}/${crypto.randomUUID()}.${ALLOWED_EXTENSIONS.includes(ext) ? ext : 'bin'}`;

    const blob = await upload(pathname, file, {
      access: 'private',
      handleUploadUrl: `${this.url}/blob-token`,
      clientPayload: JSON.stringify({ documentType, originalName: file.name }),
      // The SDK calls our token route with fetch, not HttpClient, so the
      // interceptor can't add the token here.
      headers: { Authorization: `Bearer ${this.auth.getToken()}` },
    });

    return firstValueFrom(
      this.http
        .post<{ document: UploadedDocument }>(`${this.url}/blob`, {
          documentType,
          pathname: blob.pathname,
          originalName: file.name,
        })
        .pipe(map((r) => r.document))
    );
  }
}
