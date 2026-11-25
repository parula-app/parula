/**
 * Wrapper around an async function to prevent it from being called
 * twice at the same time.
 * The second call will wait for the first call to finish, and then get the
 * result from the first call, without calling the function a second time.
 * Similar to C++ `std::call_once`.
 */
export class RunOnce<Result> {
  running: Promise<Result> | null = null;

  async runOnce(func: () => Promise<Result>): Promise<Result> {
    if (!this.running) {
      this.running = (async () => {
        try {
          return await func();
        } finally {
          this.running = null;
        }
      })();
    }

    try {
      // Return the same result if successful
      return await this.running;
    } catch (ex) {
      if (!ex?.stack) {
        throw ex;
      }
      // Join stack traces and rethrow
      let newEx = new Error(ex.message);
      // Get new stack before copying
      let newStack = newEx.stack;
      copyError(ex, newEx);
      // Remove second Error header before joining
      newEx.stack = `${ex.stack}\n${newStack.split('\n').slice(1).join('\n')}`;
      throw newEx;
    }
  }
}

function copyError(oldError: Error, newError: Error) {
  newError = Object.assign(newError, oldError);

  newError.message = oldError.message;
  newError.stack = oldError.stack;
  if (oldError.stack) {
    newError.stack = oldError.stack;
  }

  return newError;
}
