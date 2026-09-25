import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComercialDashboard } from './comercial-dashboard';

describe('ComercialDashboard', () => {
  let component: ComercialDashboard;
  let fixture: ComponentFixture<ComercialDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComercialDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(ComercialDashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
