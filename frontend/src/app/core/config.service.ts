import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ServerConfig {
  uploadMode: 'disk' | 'blob'; // disk = local development, blob = Vercel
  maxUploadBytes: number;
}

// Settings the server decides at runtime, fetched once and shared. This is
// what lets one Angular build work both locally and on Vercel.
@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly config$: Observable<ServerConfig> = inject(HttpClient)
    .get<ServerConfig>(`${environment.apiUrl}/config`)
    .pipe(shareReplay(1));
}
