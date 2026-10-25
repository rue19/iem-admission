import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { FeeRecord } from './models';

@Injectable({ providedIn: 'root' })
export class FeeService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/fees/me`;

  // 404 = nothing submitted yet, so no fee is due.
  getMine(): Observable<FeeRecord | null> {
    return this.http.get<{ feeRecord: FeeRecord }>(this.url).pipe(
      map((r) => r.feeRecord),
      catchError((err: HttpErrorResponse) => (err.status === 404 ? of(null) : throwError(() => err)))
    );
  }

  // Mock payment: sends no amount or card details; the server decides everything.
  pay(): Observable<FeeRecord> {
    return this.http.post<{ feeRecord: FeeRecord }>(`${this.url}/pay`, {}).pipe(map((r) => r.feeRecord));
  }
}
