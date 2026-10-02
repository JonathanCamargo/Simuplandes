import { Circle, Line } from "react-konva";
import { v4 as uuidv4 } from "uuid";
import { globalToRelativePos, relativeToGlobalPos } from "constraint-solver-js";

class AnchorProps {
    constructor() {
        this.id = uuidv4();
        this.body = null;
        this.position = {x: null, y: null};
        this.forces = [];
        this.velocities = [];
        this.torques = [];
    }

    // ======== SETTERS ========

    setBody(body) {
        this.body = body;
    }

    setPosition(x, y) {
        const bodyCentroid = this.body.getCenter();
        const bodyRotation = this.body.getRotation();
        const relPos = globalToRelativePos({x,y}, bodyCentroid, bodyRotation);
        this.position = relPos;
    }

    setRelativePosition(x, y) {
        this.position = {x: x, y: y};
    }

    addForce(force) {
        this.forces.push(force);
    }

    addVelocity(velocity) {
        this.velocities.push(velocity);
    }

    addTorque(torque) {
        this.torques.push(torque);
    }

    removeForce(force) {
        const forces2 = this.forces.filter((element) => {
            if(element.id === force.id) {
                return false
            }
            return true;
        });

        this.forces = forces2;
    }

    removeVelocity(velocity) {
        const vels2 = this.velocities.filter((element) => {
            if(element.id === velocity.id) {
                return false
            }
            return true;
        });

        this.velocities = vels2;
    }

    removeTorque(torque) {
        const torques2 = this.torques.filter((element) => {
            if(element.id === torque.id) {
                return false
            }
            return true;
        });

        this.torques = torques2;
    }

    // ======== GETTERS ========

    getBody() {
        return this.body;
    }

    getRelativePosition() {
        return this.position;
    }

    getAbsolutePosition() {
        const bodyCentroid = this.body.getCenter();
        const bodyRotation = this.body.getRotation();
        return relativeToGlobalPos(this.position, bodyCentroid, bodyRotation);
    }

    getKonvaComponent(onAnchorClick, onVectorClick, onTorqueClick) {
        const absPos = this.getAbsolutePosition();
        return (
            <>
                <Circle
                    x={absPos.x}
                    y={absPos.y}
                    radius={5}
                    fill="white"
                    stroke="gray"
                    onClick={() => {onAnchorClick(this)}}
                />
                {this.forces.map((force) => {
                    return force.getKonvaComponent(onVectorClick);
                })}
                {this.velocities.map((velocity) => {
                    return velocity.getKonvaComponent(onVectorClick);
                })}
            </>
        );
    }
}

export default AnchorProps;