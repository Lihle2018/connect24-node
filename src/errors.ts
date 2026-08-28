/** What goes wrong, and how to tell the cases apart. */

/** Base class, so `catch (e) { if (e instanceof Connect24Error) }` catches everything we throw. */
export class Connect24Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Without this, `instanceof` fails for subclasses when the package is compiled down to ES5 by
    // a consumer's bundler — a classic and very confusing bug to be on the receiving end of.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The request never got an answer — DNS, TLS, a timeout, a dropped socket.
 *
 * Deliberately a different class from {@link Connect24ApiError}, because the outcome is genuinely
 * unknown: the message may well have been sent. Retry with the same `idempotencyKey` and you get
 * the original message back rather than a second copy.
 */
export class Connect24ConnectionError extends Connect24Error {}

/**
 * The API answered, and said no.
 *
 * `statusCode` says what kind of problem it was:
 *
 * - `400` — malformed request; repeating it unchanged fails again
 * - `401` — key is wrong, revoked, or belongs to another account
 * - `402` — out of credit; retrying will not help
 * - `409` — a conflict, usually a name already taken
 * - `429` — rate limited (already retried a few times before you see this)
 * - `502` — the upstream provider refused the message or could not be reached
 */
export class Connect24ApiError extends Connect24Error {
  readonly statusCode: number;

  /** Field-level validation messages, when the API returned any. */
  readonly errors: Record<string, string[]>;

  constructor(statusCode: number, message: string, errors: Record<string, string[]> = {}) {
    const detail = Object.entries(errors)
      .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
      .join('; ');

    super(detail ? `${message} (${detail})` : message);
    this.statusCode = statusCode;
    this.errors = errors;
  }

  /**
   * Unwraps whichever error shape the API used, so the message says what actually happened.
   *
   * Falling back to the status code is deliberate rather than lazy: an error body that is HTML
   * from a proxy, or empty, should still produce something actionable instead of a JSON parse
   * failure hiding the real problem.
   */
  static fromResponse(statusCode: number, body: string | undefined): Connect24ApiError {
    if (!body || !body.trim()) {
      return new Connect24ApiError(statusCode, `The request failed (${statusCode}).`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Connect24ApiError(statusCode, `The request failed (${statusCode}): ${body.slice(0, 200)}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return new Connect24ApiError(statusCode, `The request failed (${statusCode}).`);
    }

    const record = parsed as Record<string, unknown>;
    const errors: Record<string, string[]> = {};
    const rawErrors = record.errors;

    if (typeof rawErrors === 'object' && rawErrors !== null) {
      for (const [field, messages] of Object.entries(rawErrors as Record<string, unknown>)) {
        errors[field] = Array.isArray(messages) ? messages.map(String) : [String(messages)];
      }
    }

    const message =
      (record.error as string) ??
      (record.detail as string) ??
      (record.title as string) ??
      (record.message as string) ??
      `The request failed (${statusCode}).`;

    return new Connect24ApiError(statusCode, String(message), errors);
  }
}
