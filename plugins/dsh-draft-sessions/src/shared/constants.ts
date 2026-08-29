/** On-disk format version. Bump only with an explicit migration. */
export const DRAFT_FILE_VERSION = 1 as const;

/** Current draft record format. */
export const DRAFT_SESSION_VERSION = 1 as const;

/** Default maximum number of drafts in a workspace. */
export const DEFAULT_MAX_DRAFTS_PER_WORKSPACE = 50;

/** Default maximum length of a title derived by consumers. */
export const DEFAULT_TITLE_MAX_LENGTH = 80;
