import { substractVectors } from "constraint-solver-js";
import { Constraint } from "matter-js";
import { v4 as uuidv4 } from "uuid";

export default class RotConstraintProps {
    constructor() {
        this.id = uuidv4();
        this.anchorA = null;
        this.anchorB = null;
        this.length = 0;
        this.stiffness = 1;
    }

    getId() {
        return this.id;
    }

    setAnchorA(anchor) {
        this.anchorA = anchor;
    }

    setAnchorB(anchor) {
        this.anchorB = anchor;
    }

    setLength(length) {
        this.length = length;
    }

    setStiffness(stiffness) {
        this.stiffness = stiffness;
    }

    getMatterJsConstraint() {
        const bodyAPos = this.anchorA.body.getCenter();
        const anchorAPos = substractVectors(this.anchorA.getAbsolutePosition(), bodyAPos);
        const bodyBPos = this.anchorB.body.getCenter();
        const anchorBPos = substractVectors(this.anchorB.getAbsolutePosition(), bodyBPos);
        return Constraint.create({
            bodyA: this.anchorA.body.getMatterJsBody(),
            bodyB: this.anchorB.body.getMatterJsBody(),
            pointA: anchorAPos,
            pointB: anchorBPos,
            length: this.length,
            stiffness: this.stiffness,
            render: {
                anchors: false
            }
        });
    }
}