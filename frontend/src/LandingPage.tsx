import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { login } from "./api";
import { actionHoverMotion, cardHoverMotion, revealMotion } from "./motionPresets";

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось выполнить вход.";
}

export function LandingPage() {
  const navigate = useNavigate();
  const [loginValue, setLoginValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
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

      if (result.role === "admin" && result.user_id) {
        navigate(`/admins/${result.user_id}/home`);
        return;
      }
      if (result.role === "expert" && result.user_id) {
        navigate(`/experts/${result.user_id}/home`);
        return;
      }
      if (result.role === "teacher" && result.user_id) {
        navigate(`/teachers/${result.user_id}/home`);
        return;
      }
      if (result.role === "student" && result.user_id) {
        navigate(`/students/${result.user_id}`);
      }
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
        <motion.div
          className="landing-auth-brand"
          {...revealMotion(0.02)}
          {...cardHoverMotion}
        >
          <span>Competence Hub</span>
        </motion.div>

        <motion.section
          className="home-card login-card landing-auth-card"
          {...revealMotion(0.05)}
          {...cardHoverMotion}
        >
          <div className="home-card__header landing-auth-card__header">
            <div>
              <h2>Авторизация</h2>
              <p className="landing-auth-card__subtitle">
                Введите логин и пароль. Система сама определит роль и откроет нужный кабинет.
              </p>
            </div>
          </div>

          <form className="home-form" onSubmit={handleSubmit}>
            <label className="field landing-auth-field">
              <span className="landing-auth-field__label">Логин</span>
              <span className="landing-auth-input">
                <input
                  value={loginValue}
                  onChange={(event) => setLoginValue(event.target.value)}
                  placeholder="Введите логин"
                  required
                />
              </span>
            </label>

            <label className="field landing-auth-field">
              <span className="landing-auth-field__label">Пароль</span>
              <span className="landing-auth-input">
                <input
                  type="password"
                  value={passwordValue}
                  onChange={(event) => setPasswordValue(event.target.value)}
                  placeholder="Введите пароль"
                  required
                />
              </span>
            </label>

            {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

            <motion.button className="primary-button" disabled={busy} {...actionHoverMotion}>
              {busy ? "Выполняю вход..." : "Войти"}
            </motion.button>
          </form>
        </motion.section>
      </main>
    </div>
  );
}
