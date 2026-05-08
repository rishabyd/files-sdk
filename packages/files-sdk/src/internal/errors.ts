export type FilesErrorCode =
  | 'NotFound'
  | 'Unauthorized'
  | 'Conflict'
  | 'Provider';

export class FilesError extends Error {
  readonly code: FilesErrorCode;
  override readonly cause?: unknown;

  constructor(code: FilesErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'FilesError';
    this.code = code;
    this.cause = cause;
  }

  static wrap(
    err: unknown,
    fallbackCode: FilesErrorCode = 'Provider'
  ): FilesError {
    if (err instanceof FilesError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new FilesError(fallbackCode, message, err);
  }
}
