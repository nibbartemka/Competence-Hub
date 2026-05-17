import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { login } from "./api";
import { actionHoverMotion, cardHoverMotion, revealMotion } from "./motionPresets";
import { saveSession } from "./session";

const BRAND_LOGO_SRC = "/assets/branding/LOGO.png";

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось выполнить вход.";
}

function UserIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M4.75 19.25a7.25 7.25 0 0 1 14.5 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M7.75 10V8.75a4.25 4.25 0 1 1 8.5 0V10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <rect
        x="5.5"
        y="10"
        width="13"
        height="9.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path
          d="M2.75 12S6.25 5.75 12 5.75 21.25 12 21.25 12 17.75 18.25 12 18.25 2.75 12 2.75 12Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
        <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.9" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 4l16 16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M9.9 6.2A10.4 10.4 0 0 1 12 5.75c5.75 0 9.25 6.25 9.25 6.25a15.85 15.85 0 0 1-2.78 3.42"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M14.12 14.12A3 3 0 0 1 9.88 9.88"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M6.72 8.7A16.31 16.31 0 0 0 2.75 12s3.5 6.25 9.25 6.25c1.67 0 3.15-.53 4.45-1.29"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const [loginValue, setLoginValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loginValue.trim() || !passwordValue.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError("");
      const result = await login({
        login: loginValue.trim(),
        password: passwordValue.trim(),
      });

      if (!result.user_id) {
        throw new Error("Сервер вернул неполные данные сессии.");
      }

      const sessionPayload = {
        role: result.role,
        userId: result.user_id,
        displayName: result.display_name,
        login: result.login,
        sessionId: result.session_id,
      } as const;

      saveSession(sessionPayload, { remember: rememberMe });

      if (result.role === "admin") {
        navigate(`/admins/${result.user_id}/home`);
        return;
      }
      if (result.role === "expert") {
        navigate(`/experts/${result.user_id}/home`);
        return;
      }
      if (result.role === "teacher") {
        navigate(`/teachers/${result.user_id}`);
        return;
      }
      navigate(`/students/${result.user_id}`);
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing-page landing-page--auth immersive-page immersive-page--student">
      <div className="landing-auth-decor landing-auth-decor--left" aria-hidden="true" />
      <div className="landing-auth-decor landing-auth-decor--right" aria-hidden="true" />
      <div className="landing-auth-orbit landing-auth-orbit--left" aria-hidden="true" />
      <div className="landing-auth-orbit landing-auth-orbit--right" aria-hidden="true" />

      <main className="landing-auth-shell">
        <motion.section
          className="landing-auth-card"
          {...revealMotion(0.05)}
          {...cardHoverMotion}
        >
          <header className="landing-auth-card__hero">
            <div className="landing-auth-card__brand">
              <img
                alt="Competence Hub"
                className="landing-auth-card__brand-logo"
                src={BRAND_LOGO_SRC}
              />
              <div className="landing-auth-card__brand-copy">
                <strong>Competence Hub</strong>
                <span>Адаптивный контроль знаний и умений</span>
              </div>
            </div>

            <div className="landing-auth-card__header">
              <h1>Авторизация</h1>
              <p className="landing-auth-card__subtitle">
                Введите учетные данные для входа в систему
              </p>
            </div>
          </header>

          <form className="landing-auth-form" onSubmit={handleSubmit}>
            <label className="landing-auth-field">
              <span className="landing-auth-field__label">Логин</span>
              <span className="landing-auth-input">
                <span className="landing-auth-input__icon">
                  <UserIcon />
                </span>
                <input
                  autoComplete="username"
                  onChange={(event) => setLoginValue(event.target.value)}
                  placeholder="Введите логин"
                  required
                  value={loginValue}
                />
              </span>
            </label>

            <label className="landing-auth-field">
              <span className="landing-auth-field__label">Пароль</span>
              <span className="landing-auth-input">
                <span className="landing-auth-input__icon">
                  <LockIcon />
                </span>
                <input
                  autoComplete={rememberMe ? "current-password" : "off"}
                  onChange={(event) => setPasswordValue(event.target.value)}
                  placeholder="Введите пароль"
                  required
                  type={showPassword ? "text" : "password"}
                  value={passwordValue}
                />
                <button
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  className="landing-auth-input__toggle"
                  onClick={(event) => {
                    event.preventDefault();
                    setShowPassword((current) => !current);
                  }}
                  type="button"
                >
                  <EyeIcon open={showPassword} />
                </button>
              </span>
            </label>

            <label className="landing-auth-remember">
              <input
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                type="checkbox"
              />
              <span className="landing-auth-remember__box" aria-hidden="true" />
              <span className="landing-auth-remember__label">Запомнить меня</span>
            </label>

            {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

            <motion.button
              className="primary-button landing-auth-submit"
              disabled={busy}
              {...actionHoverMotion}
            >
              {busy ? "Выполняю вход..." : "Войти"}
            </motion.button>
          </form>
        </motion.section>
      </main>
    </div>
  );
}
