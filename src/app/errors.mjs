// @ts-check
// Errors the HTTP layer turns into { error: { code, message, fields? } } with a status.
// `message` is plain words the UI can show as they are.

export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {{ field: string, message: string }[]} [fields]
   */
  constructor(status, code, message, fields) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (/** @type {string} */ what = "That") => new AppError(404, "not_found", `${what} isn't here any more.`);
export const badToken = () => new AppError(403, "bad_token", "This link has stopped working. Ask the crew for a fresh one.");
export const noToken = () => new AppError(401, "no_token", "This link is missing its key. Open the invite link from the group chat again.");
export const invalid = (/** @type {{ field: string, message: string }[]} */ fields, message = fields[0]?.message || "Something in the form needs another look.") => new AppError(400, "invalid", message, fields);
