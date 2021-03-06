import { TestBed, inject } from '@angular/core/testing';
import { HttpClientModule } from '@angular/common/http';
import { StorageServiceModule } from 'ngx-webstorage-service';
import { RouterModule } from '@angular/router';
import { APP_BASE_HREF } from '@angular/common';

import { RedirectGuard } from './redirect.guard';

describe('RedirectGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        HttpClientModule,
        StorageServiceModule,
        RouterModule.forRoot([
          {
            path: '',
            redirectTo: '/',
            pathMatch: 'full',
            canActivate: [RedirectGuard],
          },
        ]),
      ],
      providers: [RedirectGuard, { provide: APP_BASE_HREF, useValue: './' }],
    });
  });

  it('should ...', inject([RedirectGuard], (sut: RedirectGuard) => {
    expect(sut).toBeTruthy();
  }));
});
