export class BoardDestroyedError extends Error {
  constructor() {
    super("PixiBoard instance has been destroyed");
    this.name = "BoardDestroyedError";
  }
}

