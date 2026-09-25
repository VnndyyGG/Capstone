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
  cargando = signal(false);

  constructor(private auth: Auth, private router: Router) {}

  async onSubmit() {
    this.cargando.set(true);
    const ok = await this.auth.attemptLogin(this.email, this.password);
    this.cargando.set(false);
    if (!ok) {
      this.error.set(true);
      return;
    }
    this.error.set(false);
    const tipo = this.auth.currentRole()?.tipo;
    this.router.navigate(['/' + tipo]);
  }
}