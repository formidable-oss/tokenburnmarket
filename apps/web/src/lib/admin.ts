/*
  Who may open a Market nobody owns. Global and country Markets speak for the
  whole site, so they are opened by a short list of handles carried in
  `ADMIN_HANDLES` (comma separated, with or without a leading @) rather than by
  a role column: there is no admin UI in v1, and a deploy is the only way in.
*/

/** The parsing on its own, so it can be tested without touching the environment. */
export function parseAdminHandles(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((handle) => handle.trim().replace(/^@/, "").toLowerCase())
      .filter((handle) => handle !== ""),
  );
}

/** Whether `handle` is on a given list. Handles are compared case-insensitively. */
export function isAdminHandle(handle: string | null | undefined, raw: string | undefined): boolean {
  if (!handle) return false;
  return parseAdminHandles(raw).has(handle.trim().replace(/^@/, "").toLowerCase());
}

/** Whether `handle` is an admin of this deployment. An unset list means nobody is. */
export function isAdmin(handle: string | null | undefined): boolean {
  return isAdminHandle(handle, process.env.ADMIN_HANDLES);
}
