import { AnimatePresence, motion } from "motion/react";

type ExitConfirmDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ExitConfirmDialog({ open, onCancel, onConfirm }: ExitConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="editor-confirm-backdrop"
          onClick={onCancel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="editor-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className="editor-confirm-dialog__header">
              <p className="card__eyebrow">Выход</p>
              <h4>Выйти из аккаунта?</h4>
            </div>
            <p className="editor-confirm-dialog__text">
              Текущий кабинет будет закрыт, и система вернет вас на страницу авторизации.
            </p>
            <div className="editor-confirm-dialog__actions">
              <button className="ghost-button" onClick={onCancel} type="button">
                Нет
              </button>
              <button className="primary-button" onClick={onConfirm} type="button">
                Да, выйти
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
