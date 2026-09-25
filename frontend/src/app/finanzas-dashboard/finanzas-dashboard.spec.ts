import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FinanzasDashboard } from './finanzas-dashboard';

describe('FinanzasDashboard', () => {
  let component: FinanzasDashboard;
  let fixture: ComponentFixture<FinanzasDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinanzasDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(FinanzasDashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
