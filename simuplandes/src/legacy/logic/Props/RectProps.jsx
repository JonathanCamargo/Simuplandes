import { Bodies } from "matter-js";
import { Line, Rect } from "react-konva";
import { v4 as uuidv4 } from "uuid";
import { relativeToGlobalPos } from "constraint-solver-js";

class RectProps {
    constructor(origin, width, height, onClick) {
        this.id = uuidv4();
        this.origin = origin;
        this.width = width;
        this.height = height;
        this.color = "red";
        this.stroke = "black";
        this.isStatic = false;
        this.anchors = [];
        this.matterJsBody = null;
        this.rotation = 0;
        this.mass = 10;
    }

    relativeMove(x, y) {
        this.origin[0] += x;
        this.origin[1] += y;
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

    setMass(mass) {
        this.mass = mass;
    }

    getId() {
        return this.id;
    }

    getWidth() {
        return this.width;
    }

    getHeight() {
        return this.height;
    }

    getType() {
        return "rect";
    }

    getCenter() {
        const x = this.origin[0] + (this.width / 2);
        const y = this.origin[1] + (this.height / 2);
        return {x: x, y: y};
    }

    getRelativeVertices() {
        return [
            {x: -this.width / 2, y:  this.height / 2},
            {x: -this.width / 2, y: -this.height / 2},
            {x:  this.width / 2, y: -this.height / 2},
            {x:  this.width / 2, y:  this.height / 2},
        ];
    }

    getAbsoluteVertices() {
        const relVertices = this.getRelativeVertices();
        const absVerts = relVertices.map((pos) => {
            return relativeToGlobalPos(pos, this.getCenter(), this.rotation);
        });

        return absVerts;
    }

    getRotation() {
        return this.rotation;
    }

    setRotation(rot) {
        this.rotation = rot;
    }

    getKonvaPoints() {
        const points = []
        const absVertices = this.getAbsoluteVertices();
        absVertices.forEach((vertex) => {
            points.push(vertex.x);
            points.push(vertex.y);
        })
        return points;
    }

    getKonvaComponent(onBodyClick, onAnchorClick, onVectorClick, onTorqueClick) {
        return (
            <>
                <Line
                    points={this.getKonvaPoints()}
                    closed
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
    // getKonvaComponent(onBodyClick, onAnchorClick, onVectorClick, onTorqueClick) {
    //     return (
    //         <>
    //             <Rect
    //                 x={this.origin[0]}
    //                 y={this.origin[1]}
    //                 height={this.height}
    //                 width={this.width}
    //                 fill={this.color}
    //                 stroke={this.stroke}
    //                 onClick={() => {onBodyClick(this);}}
    //                 rotation={this.rotation}
    //             />
    //             {
    //                 this.anchors.map((anchor) => {
    //                     return anchor.getKonvaComponent(onAnchorClick, onVectorClick, onTorqueClick);
    //                 })
    //             }
    //         </>
    //     )
    // }

    resetMatterJsBody() {
        this.matterJsBody = null;
    }

    getMatterJsBody() {
        if(!this.matterJsBody) {
            this.matterJsBody = Bodies.rectangle(
                this.getCenter().x,
                this.getCenter().y,
                this.width,
                this.height,
                {
                    mass: this.mass,
                    restitution: 0.9,
                    friction: 0.005,
                    render: {
                        fillStyle: this.color,
                        strokeStyle: "1px solid" + this.stroke
                    },
                    isStatic: this.isStatic,
                    angle: this.rotation,
                    frictionAir: 0
                }      
            );
        }

        return this.matterJsBody;
    }
}

export default RectProps