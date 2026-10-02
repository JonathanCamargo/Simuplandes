/**
 * Public barrel for `src/geom`: pure vector math and local<->world frame
 * transforms. Framework-free (no React, Konva or matter-js). Angles are
 * radians everywhere, counter-clockwise positive, in a y-up frame.
 *
 * This module replaces the vector/frame half of the lost legacy solver
 * dependency (its source was never committed and is unrecoverable). Legacy
 * name migration (old name -> new name), for anyone porting call sites out
 * of `src/legacy`:
 *
 * | old (legacy) name      | src/geom      | Notes                         |
 * |------------------------|---------------|-------------------------------|
 * | addVectors              | add           |                               |
 * | substractVectors (sic)  | sub           |                               |
 * | multiplyVector          | scale         |                               |
 * | rotateVector            | rotate        |                               |
 * | unitVector              | normalize     | zero vector -> ZERO, not NaN  |
 * | vectorMagnitude         | magnitude     |                               |
 * | vectorDirection         | direction     |                               |
 * | magAndDir2Vector        | fromPolar     |                               |
 * | relativeToGlobalPos     | localToWorld  |                               |
 * | globalToRelativePos     | worldToLocal  |                               |
 *
 * `Body`, `World`, `Solver`, `FixedConstraint` and `RotConstraint` from the
 * old package are intentionally NOT ported here — Phase 3 replaces the
 * solver half with a new Newton-Raphson kinematic engine.
 */

export * from "./vec2";
export * from "./frame";
