import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth } from '../auth';

@Component({
  imports: [FormsModule],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login {
  email = '';
  password = '';
  error = signal(false);

  constructor(private auth: Auth, private router: Router) {}

  onSubmit() {
    const ok = this.auth.attemptLogin(this.email, this.password);
    if (!ok) {
      this.error.set(true);
      return;
    }
    this.error.set(false);
    const tipo = this.auth.currentRole()?.tipo;
    this.router.navigate(['/' + tipo]);
  }
}