/*
  What the CLI prints when a command throws.

  `fetch` reports every network failure as the same two words, "fetch failed",
  and puts the reason in `cause`. Printing only `error.message` therefore hides
  the one detail worth having: which host, and why it did not answer. This walks
  the cause chain so the terminal says `fetch failed: getaddrinfo ENOTFOUND
  example.com` instead.
*/

/** One link of the chain: its message, and its errno code if the message omits it. */
function messageOf(value: unknown): string {
  if (!(value instanceof Error)) return String(value);
  const code = (value as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0 && !value.message.includes(code)) {
    return `${value.message} (${code})`;
  }
  return value.message;
}

/**
 * An error and its causes as one line, outermost first.
 *
 * Adjacent duplicates are dropped, because a wrapper that repeats its cause
 * verbatim adds nothing. Cycles terminate: `cause` is a plain property and
 * nothing stops it pointing back up.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const part = messageOf(current);
    if (part.length > 0 && part !== parts[parts.length - 1]) parts.push(part);
    current = current instanceof Error ? current.cause : undefined;
  }

  return parts.length > 0 ? parts.join(": ") : String(error);
}
