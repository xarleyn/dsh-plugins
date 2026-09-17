/**
 * The comparison slice of the `documents` configuration.
 *
 * The values live in `defaults.ts` beside every other document default, because
 * that module is the only part of the subsystem the browser settings bundle
 * reaches. This module is the name the comparison code imports them by.
 *
 * @module
 */

export type {
  QaDocumentsComparisonConfig,
  ResolvedComparisonConfig,
} from "../defaults.js";
