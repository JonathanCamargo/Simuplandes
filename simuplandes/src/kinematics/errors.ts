/**
 * Error types for `src/kinematics`. These are thrown for programmer/caller
 * mistakes (bad references, malformed input arrays) — never for solver
 * non-convergence, which is reported through a result `status`, not a throw
 * (see `position.ts`'s `PositionSolveResult`).
 */

/** The set of error codes `KinematicsError` can carry. */
export type KinematicsErrorCode = "unknown-site" | "unknown-joint" | "bad-input-length";

/** Thrown when a caller passes a document/joint/input that the compiled system cannot resolve. */
export class KinematicsError extends Error {
  readonly code: KinematicsErrorCode;

  constructor(code: KinematicsErrorCode, message: string) {
    super(message);
    this.name = "KinematicsError";
    this.code = code;
  }
}
