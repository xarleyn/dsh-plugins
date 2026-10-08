import { useState, type FormEvent } from "react";
import {
  QA_MIN_PASSWORD_LENGTH,
  accountsErrorMessage,
  type QaAccountsController,
  type QaAccountsSnapshot,
} from "../QaAccountsController.js";

export interface QaAuthGateProps {
  readonly accounts: QaAccountsController;
  readonly snapshot: QaAccountsSnapshot;
  readonly title: string;
  readonly logoUrl: string | null;
  readonly allowRegistration: boolean;
}

/** The Host's address shape, mirrored so the card refuses before the round trip. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Own copy for input the browser would otherwise answer with its own English bubble. */
function refusalOf(email: string, password: string | null): string | null {
  if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) {
    return accountsErrorMessage("invalid-email");
  }
  if (password !== null && password.length < QA_MIN_PASSWORD_LENGTH) {
    return accountsErrorMessage("weak-password");
  }
  return null;
}

function Logo({ logoUrl }: { readonly logoUrl: string | null }) {
  if (logoUrl !== null) {
    return (
      <img
        className="dsh-qa-auth__logo"
        data-testid="qa-surface-auth-logo"
        src={logoUrl}
        alt=""
      />
    );
  }
  return (
    <svg
      className="dsh-qa-auth__logo"
      data-testid="qa-surface-auth-logo"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M10 2.75a6.4 6.4 0 0 0-4.9 10.52c.2.24.28.5.24.79l-.2 1.44 1.9-.7c.24-.09.5-.06.74.05A6.4 6.4 0 1 0 10 2.75Z" />
      <path d="M7.4 8.1h5.2M7.4 11h3.2" />
    </svg>
  );
}

/**
 * The full-frame login/registration card shown instead of the chat while the
 * deployment has accounts enabled and the browser holds no valid identity.
 * Both halves of the error line are the surface's own copy: the card refuses
 * mistyped input itself, and renders the Host's coarse codes in audience-safe
 * words.
 */
export function QaAuthGate(props: QaAuthGateProps) {
  const { snapshot, accounts } = props;
  const gate = snapshot.stage === "gate" ? snapshot : undefined;
  const mode = gate?.mode ?? "login";
  const busy = gate?.busy ?? false;
  const notice = gate?.notice ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const showRegister = props.allowRegistration;
  // The reset card is the same card with one field: the request only needs an
  // address, and asking for a password the user does not have would be absurd.
  const reset = mode === "reset";
  const error = refusal ?? gate?.error ?? null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const next = refusalOf(email, reset ? null : password);
    setRefusal(next);
    if (next !== null) return;
    const operation = reset
      ? accounts.requestPasswordReset(email)
      : mode === "register"
        ? accounts.register(email, password)
        : accounts.login(email, password);
    void operation;
  };
  return (
    <main
      className="dsh-qa-surface dsh-qa-auth"
      data-testid="qa-surface-auth"
      aria-label="Вход в помощник"
    >
      <form
        className="dsh-qa-auth__card"
        data-testid="qa-surface-auth-card"
        noValidate
        onSubmit={submit}
      >
        <div className="dsh-qa-auth__brand" data-testid="qa-surface-auth-brand">
          <Logo logoUrl={props.logoUrl} />
          <h1 data-testid="qa-surface-auth-title">{props.title}</h1>
        </div>
        {reset ? (
          <p className="dsh-qa-auth__lead" data-testid="qa-surface-auth-lead">
            Укажите email: заявку увидит оператор и сбросит пароль. Почта с
            ссылкой на этом стенде не настроена.
          </p>
        ) : null}
        {showRegister && !reset ? (
          <div
            className="dsh-qa-auth__tabs"
            data-testid="qa-surface-auth-tabs"
            role="tablist"
            aria-label="Вход или регистрация"
          >
            <button
              type="button"
              role="tab"
              data-testid="qa-surface-auth-tab-login"
              aria-selected={mode === "login"}
              className={
                mode === "login"
                  ? "dsh-qa-auth__tab dsh-qa-auth__tab--active"
                  : "dsh-qa-auth__tab"
              }
              onClick={() => {
                setRefusal(null);
                accounts.setMode("login");
              }}
            >
              Вход
            </button>
            <button
              type="button"
              role="tab"
              data-testid="qa-surface-auth-tab-register"
              aria-selected={mode === "register"}
              className={
                mode === "register"
                  ? "dsh-qa-auth__tab dsh-qa-auth__tab--active"
                  : "dsh-qa-auth__tab"
              }
              onClick={() => {
                setRefusal(null);
                accounts.setMode("register");
              }}
            >
              Регистрация
            </button>
          </div>
        ) : null}
        {/* The constraints stay declarative: `noValidate` gives the card the answer. */}
        <label
          className="dsh-qa-auth__field"
          data-testid="qa-surface-auth-email-field"
        >
          <span>Email</span>
          <input
            type="email"
            name="email"
            data-testid="qa-surface-auth-email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(event) => {
              setRefusal(null);
              setEmail(event.currentTarget.value);
            }}
          />
        </label>
        {reset ? null : (
          <label
            className="dsh-qa-auth__field"
            data-testid="qa-surface-auth-password-field"
          >
            <span>Пароль</span>
            <input
              type="password"
              name="password"
              data-testid="qa-surface-auth-password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              required
              minLength={QA_MIN_PASSWORD_LENGTH}
              disabled={busy}
              value={password}
              onChange={(event) => {
                setRefusal(null);
                setPassword(event.currentTarget.value);
              }}
            />
          </label>
        )}
        {error === null ? null : (
          <p
            className="dsh-qa-auth__error"
            data-testid="qa-surface-auth-error"
            role="alert"
          >
            {error}
          </p>
        )}
        {notice === null ? null : (
          <p
            className="dsh-qa-auth__notice"
            data-testid="qa-surface-auth-notice"
            role="status"
          >
            {notice}
          </p>
        )}
        <button
          type="submit"
          className="dsh-qa-auth__submit"
          data-testid="qa-surface-auth-submit"
          disabled={busy}
        >
          {busy
            ? "Подождите…"
            : reset
              ? "Отправить заявку"
              : mode === "register"
                ? "Зарегистрироваться"
                : "Войти"}
        </button>
        <button
          type="button"
          className="dsh-qa-auth__link"
          data-testid="qa-surface-auth-forgot"
          disabled={busy}
          onClick={() => {
            setRefusal(null);
            accounts.setMode(reset ? "login" : "reset");
          }}
        >
          {reset ? "Вернуться ко входу" : "Забыли пароль?"}
        </button>
      </form>
    </main>
  );
}
