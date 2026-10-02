import WorldProps from "../Props/WorldProps";
import AnchorProps from "../Props/AnchorProps"
import { Body, FixedConstraint, RotConstraint, World, substractVectors, Solver } from "constraint-solver-js";
import CircleProps from "../Props/CircleProps";
import RectProps from "../Props/RectProps";
import PolyProps from "../Props/PolyProps";

/**
 * 
 * @param {WorldProps} worldProps 
 */
export function solveConstraints(worldProps) {
    const solver = new Solver(1e-5, 1e3, 3000, 1e-6);
    const bodiesDict = worldProps.getBodyDict();
    const rotConstraints = worldProps.getRotConstraintList().map((rcp) => {
        return new RotConstraint(
            bodyToSolverBody(rcp.anchorA.getBody()),
            anchorToSolverAnchor(rcp.anchorA),
            bodyToSolverBody(rcp.anchorB.getBody()),
            anchorToSolverAnchor(rcp.anchorB)
        );
    });
    if (rotConstraints.length === 0) {
        return;
    }
    const fixConstraints = [];
    worldProps.getBodyList().forEach((bp) => {
        if(bp.isStatic) {
            fixConstraints.push(new FixedConstraint(
                bodyToSolverBody(bp)
            ));
        }
    });
    // console.log(rotConstraints);
    // console.log(fixConstraints);
    const world = new World(rotConstraints, fixConstraints);
    const solBodies = world.solve(solver).getBodies();
    for(const [id, solBody] of Object.entries(solBodies)) {
        const body = bodiesDict[id];
        const prevPos = body.getCenter();
        const newPos = {x: solBody.x, y: solBody.y};
        const relMove = substractVectors(newPos, prevPos);
        body.relativeMove(relMove.x, relMove.y);
        body.setRotation(solBody.theta);
    }
}

/**
 * 
 * @param {(CircleProps | RectProps | PolyProps)} body 
 * @returns 
 */
function bodyToSolverBody(body) {
    return new Body(body.id, body.getCenter().x, body.getCenter().y, body.getRotation());
}

/**
 * @param {AnchorProps} anchor 
 */
function anchorToSolverAnchor(anchor) {
    return {x: anchor.getRelativePosition().x, y: anchor.getRelativePosition().y};
}