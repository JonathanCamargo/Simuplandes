import { Bodies } from "matter-js";
import { Circle } from "react-konva";
import { v4 as uuidv4 } from "uuid";

class CircleProps {
    constructor(center, radius) {
        this.id = uuidv4();
        this.center = center;
        this.radius = radius;
        this.color = "green";
        this.stroke = "black";
        this.isStatic = false;
        this.anchors = [];
        this.matterJsBody = null;
        this.rotation = 0;
        this.mass = 10;
    }

    addAnchor(anchor) {
        this.anchors.push(anchor);
    }

    getAnchors() {
        return this.anchors;
    }

    getMass() {
        return this.mass;
    }

    setMass (mass) {
        this.mass = mass;
    }

    getId() {
        return this.id;
    }

    getCenter() {
        return {x: this.center[0], y: this.center[1]};
    }

    getRotation() {
        return this.rotation;
    }

    setRotation(rot) {
        this.rotation = rot;
    }

    getRadius() {
        return this.radius;
    }

    getType() {
        return "circle";
    }

    relativeMove(x, y) {
        this.center[0] += x;
        this.center[1] += y;
    }

    getKonvaComponent(onBodyClick, onAnchorClick, onVectorClick, onTorqueClick) {
        return (
            <>
                <Circle
                    x={this.center[0]}
                    y={this.center[1]}
                    radius={this.radius}
                    fill={this.color}
                    stroke={this.stroke}
                    onClick={() => {onBodyClick(this);}}
                />
                {
                    this.anchors.map((anchor) => {
                        return anchor.getKonvaComponent(onAnchorClick, onVectorClick, onTorqueClick);
                    })
                }
            </>
        )
    }

    resetMatterJsBody() {
        this.matterJsBody = null;
    }

    
    getMatterJsBody() {
        if (!this.matterJsBody) {
            this.matterJsBody = Bodies.circle(
                this.center[0],
                this.center[1],
                this.radius,
                {
                    mass: this.mass,
                    restitution: 0.9,
                    friction: 0.005,
                    render: {
                        fillStyle: this.color
                    },
                    isStatic: this.isStatic,
                    angle: this.rotation,
                    frictionAir: 0
            });
        }

        return this.matterJsBody;
    }
}

export default CircleProps