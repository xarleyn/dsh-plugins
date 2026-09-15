import { useState, type FormEvent } from "react";
import type {
  QaAccountsController,
  QaAccountsSnapshot,
} from "../QaAccountsController.js";

export interface QaAuthGateProps {
  readonly accounts: QaAccountsController;
  readonly snapshot: QaAccountsSnapshot;
  readonly title: string;
  readonly logoUrl: string | null;
  readonly allowRegistration: boolean;
}

function Logo({ logoUrl }: { readonly logoUrl: string | null }) {
  if (logoUrl !== null) {
    return <img className="dsh-qa-auth__logo" src={logoUrl} alt="" />;
  }
  return (
    <svg className="dsh-qa-auth__logo" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.75a6.4 6.4 0 0 0-4.9 10.52c.2.24.28.5.24.79l-.2 1.44 1.9-.7c.24-.09.5-.06.74.05A6.4 6.4 0 1 0 10 2.75Z" />
      <path d="M7.4 8.1h5.2M7.4 11h3.2" />
    </svg>
  );
}

/**
 * The full-frame login/registration card shown instead of the chat while the
 * deployment has accounts enabled and the browser holds no valid identity.
 * Errors are the Host's coarse codes rendered as audience-safe copy.
 */
export function QaAuthGate(props: QaAuthGateProps) {
  const { snapshot, accounts } = props;
  const mode = snapshot.stage === "gate" ? snapshot.mode : "login";
  const busy = snapshot.stage === "gate" ? snapshot.busy : false;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const showRegister = props.allowRegistration;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const operation =
      mode === "register"
        ? accounts.register(email, password)
        : accounts.login(email, password);
    void operation;
  };
  return (
    <main className="dsh-qa-surface dsh-qa-auth" aria-label="Вход в помощник">
      <form className="dsh-qa-auth__card" onSubmit={submit}>
        <div className="dsh-qa-auth__brand">
          <Logo logoUrl={props.logoUrl} />
          <h1>{props.title}</h1>
        </div>
        {showRegister ? (
          <div
            className="dsh-qa-auth__tabs"
            role="tablist"
            aria-label="Вход или регистрация"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={
                mode === "login"
                  ? "dsh-qa-auth__tab dsh-qa-auth__tab--active"
                  : "dsh-qa-auth__tab"
              }
              onClick={() => accounts.setMode("login")}
            >
              Вход
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={
                mode === "register"
                  ? "dsh-qa-auth__tab dsh-qa-auth__tab--active"
                  : "dsh-qa-auth__tab"
              }
              onClick={() => accounts.setMode("register")}
            >
              Регистрация
            </button>
          </div>
        ) : null}
        <label className="dsh-qa-auth__field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        <label className="dsh-qa-auth__field">
          <span>Пароль</span>
          <input
            type="password"
            name="password"
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            required
            minLength={8}
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        {snapshot.stage === "gate" && snapshot.error !== null ? (
          <p className="dsh-qa-auth__error" role="alert">
            {snapshot.error}
          </p>
        ) : null}
        <button type="submit" className="dsh-qa-auth__submit" disabled={busy}>
          {busy
            ? "Подождите…"
            : mode === "register"
              ? "Зарегистрироваться"
              : "Войти"}
        </button>
      </form>
    </main>
  );
}
