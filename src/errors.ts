export class GameError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
