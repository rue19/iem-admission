import { Routes } from '@angular/router';
import { guestGuard, roleGuard } from './core/auth.guards';
import { Login } from './pages/login/login';
import { Register } from './pages/register/register';
import { ApplicantDashboard } from './pages/applicant-dashboard/applicant-dashboard';
import { AdminReview } from './pages/admin-review/admin-review';
import { DocumentUpload } from './pages/document-upload/document-upload';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: 'register', component: Register, canActivate: [guestGuard] },
  { path: 'dashboard', component: ApplicantDashboard, canActivate: [roleGuard('applicant')] },
  { path: 'documents', component: DocumentUpload, canActivate: [roleGuard('applicant')] },
  { path: 'admin', component: AdminReview, canActivate: [roleGuard('admin')] },
  { path: '**', redirectTo: 'login' },
];
