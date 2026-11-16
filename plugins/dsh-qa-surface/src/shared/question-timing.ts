export const QA_QUESTION_TIMEOUT_DEFAULT_MINUTES = 30;
// Largest whole-minute delay a single Host timer can represent.
export const QA_QUESTION_TIMEOUT_MAX_MINUTES = Math.floor(
  2_147_483_647 / 60_000,
);
