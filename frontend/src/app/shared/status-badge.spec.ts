import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';
import { ApplicationStatus } from '../core/models';

describe('StatusBadge', () => {
  it.each([
    ['Draft', 'draft'],
    ['Under Review', 'under-review'],
    ['Approved', 'approved'],
  ] as [ApplicationStatus, string][])('renders %s with class %s', async (status, cssClass) => {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.textContent?.trim()).toBe(status);
    expect(el.classList).toContain(cssClass);
  });
});
