import {
  OperationSolvedAnswerPreview,
} from "./OperationTaskSchemaViews";
import type { StudentAssignedTask } from "../types";

type StudentTaskDebugAnswerModalProps = {
  task: StudentAssignedTask | null;
  onClose: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function choiceTexts(task: StudentAssignedTask, solution: Record<string, unknown>) {
  const correctIds = Array.isArray(solution.correct_option_ids)
    ? solution.correct_option_ids.map((item) => String(item))
    : [];
  const optionById = new Map((task.content.options ?? []).map((option) => [option.id, option.text]));
  return correctIds.map((id) => optionById.get(id) ?? id);
}

function buildFallbackSolution(task: StudentAssignedTask) {
  const feedback = isRecord(task.progress.last_feedback) ? task.progress.last_feedback : null;
  if (!feedback) return {};

  if (Array.isArray(feedback.correct_option_ids) || Array.isArray(feedback.correct_options)) {
    return {
      kind: "choice",
      correct_option_ids: Array.isArray(feedback.correct_option_ids) ? feedback.correct_option_ids : [],
      correct_options: Array.isArray(feedback.correct_options) ? feedback.correct_options : [],
    };
  }

  if (Array.isArray(feedback.correct_pairs)) {
    return {
      kind: "matching",
      pairs: feedback.correct_pairs,
    };
  }

  if (Array.isArray(feedback.correct_order) || Array.isArray(feedback.correct_order_ids)) {
    return {
      kind: "ordering",
      ordered_texts: Array.isArray(feedback.correct_order) ? feedback.correct_order : [],
      correct_order_ids: Array.isArray(feedback.correct_order_ids) ? feedback.correct_order_ids : [],
    };
  }

  if (feedback.expected_output !== undefined || Array.isArray(feedback.accepted_answers)) {
    return {
      kind: "text",
      expected_output: feedback.expected_output,
      accepted_answers: Array.isArray(feedback.accepted_answers) ? feedback.accepted_answers : [],
    };
  }

  return {};
}

export default function StudentTaskDebugAnswerModal({
  task,
  onClose,
}: StudentTaskDebugAnswerModalProps) {
  if (!task) return null;

  const solution = isRecord(task.content.debug_solution)
    ? task.content.debug_solution
    : buildFallbackSolution(task);
  const kind = String(solution.kind ?? "");
  const explicitChoiceTexts = Array.isArray(solution.correct_options)
    ? solution.correct_options.map((item) => String(item))
    : [];
  const resolvedChoiceTexts = explicitChoiceTexts.length ? explicitChoiceTexts : choiceTexts(task, solution);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className="modal-panel student-task-debug-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-panel__header">
          <div>
            <p className="card__eyebrow">Отладка</p>
            <h2>Правильный ответ</h2>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Закрыть
          </button>
        </div>
        <div className="modal-panel__body student-task-debug-modal__body">
          <div className="student-task-debug-modal__meta">
            <strong>{task.title || task.topic_name}</strong>
            <span>{task.primary_element.name}</span>
          </div>

          {kind === "choice" ? (
            <div className="student-task-debug-modal__section">
              <strong>Верные варианты</strong>
              <ol className="student-task-debug-modal__list">
                {resolvedChoiceTexts.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {kind === "matching" ? (
            <div className="student-task-debug-modal__section">
              <strong>Правильные соответствия</strong>
              <div className="student-task-debug-modal__pairs">
                {(Array.isArray(solution.pairs) ? solution.pairs : []).map((rawPair, index) => {
                  const pair = isRecord(rawPair) ? rawPair : {};
                  return (
                    <div className="student-task-debug-modal__pair" key={`${pair.left ?? index}-${pair.right ?? index}`}>
                      <span>{String(pair.left ?? "")}</span>
                      <strong>{String(pair.right ?? "")}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {kind === "ordering" ? (
            <div className="student-task-debug-modal__section">
              <strong>Правильный порядок</strong>
              <ol className="student-task-debug-modal__list">
                {(Array.isArray(solution.ordered_texts) ? solution.ordered_texts : []).map((text, index) => (
                  <li key={`${text}-${index}`}>{String(text)}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {kind === "text" && solution.expected_output !== undefined ? (
            <OperationSolvedAnswerPreview
              answer={solution.expected_output}
              outputSchema={task.content.output_schema}
            />
          ) : null}

          {kind === "text" && Array.isArray(solution.accepted_answers) && solution.accepted_answers.length ? (
            <div className="student-task-debug-modal__section">
              <strong>Допустимые текстовые ответы</strong>
              <ul className="student-task-debug-modal__list student-task-debug-modal__list--bulleted">
                {solution.accepted_answers.map((answer, index) => (
                  <li key={`${answer}-${index}`}>{String(answer)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!kind ? (
            <div className="student-task-debug-modal__section">
              <p className="card__text">Эталонный ответ не получен для этого задания.</p>
              <p className="card__text">
                Возможно, запущена устаревшая версия сервера. Перезапустите сервер и
                обновите страницу, чтобы в данных задания появилось поле{" "}
                <code>debug_solution</code>.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
