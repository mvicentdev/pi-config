/**
 * xml.ts — escaping for the `<task-notification>` payloads.
 *
 * A module of its own so the escaping can be shared and tested apart from
 * `index.ts`.
 */

/** Escape XML special characters to prevent injection in structured notifications. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
