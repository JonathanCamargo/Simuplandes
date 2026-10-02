import { Line } from "react-konva";
import { v4 as uuidv4 } from "uuid";
import KonvaArrow from "../../components/utils/KonvaArrow";
import AnchorProps from "./AnchorProps";
import { addVectors, substractVectors, rotateVector } from "constraint-solver-js";
import { globalToRelativePos } from "constraint-solver-js";
import { vectorDirection } from "constraint-solver-js";
import { magAndDir2Vector } from "constraint-solver-js";

export default class VectorProps {
    // TODO take into account body rotations.
    constructor() {
        this.id = uuidv4();
        /**
         * @type {AnchorProps | null}
         */
        this.anchor = null;
        this.vector = {x: null, y: null};
        this.fixedDirection = true;
        this.color = "black";
        this.type = null;
    }

    // ======== Getters =========

    getBody() {
        return this.anchor.getBody();
    }

    getAbsoluteOrigin() {
        return this.anchor.getAbsolutePosition();
    }

    getMagnitude() {
        return Math.sqrt( Math.pow(this.vector.x, 2) + Math.pow(this.vector.y, 2) );
    }

    getDirection() {
        return vectorDirection(this.vector);
    }

    getRelativeVector() {
        return this.vector;
    }

    getAbsoluteVectorEnd() {
        if(this.fixedDirection) {
            const absOrigin = this.getAbsoluteOrigin();
            return addVectors(this.vector, absOrigin);
        } else {
            const rotation = this.getBody().getRotation();
            const centroid = this.getBody().getCenter();
            const vectorFromCentroid = addVectors(this.vector, this.anchor.getRelativePosition());
            const rotVector = rotateVector(vectorFromCentroid, rotation);
            return addVectors(rotVector, centroid);
        }
    }

    getKonvaComponent(onVectorClick) {
        const absOrigin = this.getAbsoluteOrigin();
        const absVecEnd = this.getAbsoluteVectorEnd();
        return (
            <KonvaArrow
                start={absOrigin}
                end={absVecEnd}
                color={this.color}
                onClick={e => {
                    onVectorClick(this);
                }}
            />
        )
    }

    // ======== Setters =========

    setVectorEndAbsolute(x, y) {
        const centroid = this.getBody().getCenter();
        const rotation = this.getBody().getRotation();
        const endFromCentroid = globalToRelativePos({x,y}, centroid, rotation);
        const anchorRelativePos = this.anchor.getRelativePosition();
        this.vector = substractVectors(endFromCentroid, anchorRelativePos);
    }

    setAnchor(anchor) {
        this.anchor = anchor;
    }

    setRelativeDirection() {
        this.fixedDirection = false;
    }

    setFixedDirection() {
        this.fixedDirection = true;
    }

    setDirection(dir) {
        const magnitude = this.getMagnitude();
        const vec = magAndDir2Vector(magnitude, dir);
        this.vector = vec;
    }

    setMagnitude(mag) {
        const dir = this.getDirection();
        const vec = magAndDir2Vector(mag, dir);
        this.vector = vec;
    }
}