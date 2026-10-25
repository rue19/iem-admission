import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { Application, ApplicationInput, Course, SubmitResult } from './models';

// All applicant-side calls for courses and the application, in one place, so
// components never build URLs themselves. The JWT is added by the interceptor.
@Injectable({ providedIn: 'root' })
export class ApplicationService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getCourses(): Observable<Course[]> {
    return this.http.get<{ courses: Course[] }>(`${this.api}/courses`).pipe(map((r) => r.courses));
  }

  // 404 just means "not started yet", which is a normal state, not an error.
  getMine(): Observable<Application | null> {
    return this.http.get<{ application: Application }>(`${this.api}/applications/me`).pipe(
      map((r) => r.application),
      catchError((err: HttpErrorResponse) => (err.status === 404 ? of(null) : throwError(() => err)))
    );
  }

  create(input: ApplicationInput): Observable<Application> {
    return this.http
      .post<{ application: Application }>(`${this.api}/applications`, input)
      .pipe(map((r) => r.application));
  }

  // No body: the server checks the application and documents it already has.
  submit(): Observable<SubmitResult> {
    return this.http.post<SubmitResult>(`${this.api}/applications/me/submit`, {});
  }

  update(input: Partial<ApplicationInput>): Observable<Application> {
    return this.http
      .put<{ application: Application }>(`${this.api}/applications/me`, input)
      .pipe(map((r) => r.application));
  }
}
