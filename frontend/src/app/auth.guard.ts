import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.currentRole() ? true : router.createUrlTree(['/']);
};

export const roleGuard = (tipo: string): CanActivateFn => () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const actual = auth.currentRole()?.tipo;
  return actual === tipo ? true : router.createUrlTree(actual ? ['/' + actual] : ['/']);
};