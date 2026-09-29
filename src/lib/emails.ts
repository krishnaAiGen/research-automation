export type ParsedEmails = { emails: string[]; invalid: string[] };

// Deliberately loose: it rejects the things a paste actually gets wrong (no
// @, no dot in the domain, stray words) without trying to out-guess RFC 5322.
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Split a pasted blob into addresses. Commas are the documented separator;
 * newlines, semicolons and spaces are accepted too because a paste out of a
 * spreadsheet or a mail client uses whichever it feels like. Duplicates
 * within the blob collapse case-insensitively.
 */
export function parseEmailList(raw: string): ParsedEmails {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];

  for (const token of String(raw ?? "").split(/[,;\s]+/)) {
    // "Kenji Maruyama <k@example.com>" pastes leave brackets and punctuation.
    const candidate = token.trim().replace(/^[<"'(]+/, "").replace(/[>"'),.]+$/, "");
    if (!candidate) continue;
    if (!EMAIL.test(candidate)) {
      invalid.push(candidate);
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(candidate);
  }

  return { emails, invalid };
}
