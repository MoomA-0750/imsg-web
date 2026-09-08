export class WebError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); }
}
