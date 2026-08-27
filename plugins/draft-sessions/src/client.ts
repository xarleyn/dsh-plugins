/**
 * Client-side entrypoint for the draft sessions plugin.
 */

// Import from plugin-kit package
import { createLogger } from "@scope/dsh-plugin-kit";

const logger = createLogger("draft-sessions:client");

export interface DraftSessionClient {
  id: string;
  title: string;
  content: string;
}

/**
 * List draft sessions on the client side.
 */
export async function listDrafts(): Promise<DraftSessionClient[]> {
  logger.info("Listing drafts (client)");

  // Placeholder — real implementation would fetch from DSH API
  return [];
}

/**
 * Create a draft session from the client.
 */
export async function createDraft(
  title: string,
  content: string,
): Promise<DraftSessionClient> {
  logger.info("Creating draft (client)", { title });

  // Placeholder — real implementation would POST to DSH API
  return { id: `draft-${Date.now()}`, title, content };
}
