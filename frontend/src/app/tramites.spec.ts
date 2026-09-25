import { TestBed } from '@angular/core/testing';
import { Tramites } from './tramites';

describe('Tramites', () => {
  let service: Tramites;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Tramites);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
