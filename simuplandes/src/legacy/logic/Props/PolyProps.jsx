import { Bodies, Vertices } from "matter-js";
import { Line } from "react-konva";
import {v4 as uuidv4} from "uuid";
import { addVectors, rotateVector } from "constraint-solver-js";

class PolyProps {
    constructor(origin) {
        this.id = uuidv4();
        this.origin = origin;
        this.color = "yellow";
        this.stroke = "black";
        this.vertices = [{x: origin[0], y: origin[1]}];
        this.isStatic = false;
        this.anchors = [];
        this.matterJsBody = null;
        this.rotation = 0;
        this.mass = 10;
    }

    relativeMove(x, y) {
        this.vertices.forEach((vertex, i) => {
            const newX = vertex.x + x;
            const newY = vertex.y + y;
            this.vertices[i] = {x: newX, y: newY};
        });
    }

    setRotation(rot) {
        // Define rotation
        this.rotation = rot;
        // Get centroid
        const org = this.getCenter();
        // Get vertices relative to centroid
        const relVertices = this.getRelativeVertices();
        const rotVertices = relVertices.map((pos) => {
            // Rotate relative vertices
            pos = rotateVector(pos, rot);
            // Get absolute rotated vectors
            return addVectors(pos, org);
        });

        // Set new vertices
        this.vertices = rotVertices;
    }

    setMass(mass) {
        this.mass = mass;
    }

    getMass() {
        return this.mass;
    }

    addAnchor(anchor) {
        this.anchors.push(anchor);
    }

    getAnchors() {
        return this.anchors;
    }

    getId() {
        return this.id;
    }

    getType() {
        return "poly";
    }

    addPoint(x, y) {
        this.vertices.push({x: x, y: y});
    }

    getVertices() {
        return this.vertices;
    }
    
    editLastPoint(x,y) {
        const pos = this.vertices.length - 1;
        this.vertices[pos] = {x: x, y: y};
    }

    getKonvaPoints() {
        const points = []
        this.vertices.forEach((vertex) => {
            points.push(vertex.x);
            points.push(vertex.y);
        })
        return points;
    }

    getCenter() {
        const vertices = Vertices.hull(this.vertices);
        return Vertices.centre(vertices);
    }

    getRotation() {
        return this.rotation;
    }

    getRelativeVertices() {
        const cm = this.getCenter();
        const vertices = [];
        this.vertices.forEach((vertex) => {
            vertices.push({x: vertex.x - cm.x, y: vertex.y - cm.y});
        });

        return Vertices.clockwiseSort(vertices);
    }

    resetMatterJsBody() {
        this.matterJsBody = null;
    }

    getMatterJsBody() {
        if(!this.matterJsBody) {
            const cm = this.getCenter();
            let vertices = this.getRelativeVertices();
            vertices = Vertices.hull(vertices);
    
            this.matterJsBody = Bodies.fromVertices(
                cm.x, cm.y,
                vertices,
                {
                    mass: this.mass,
                    restitution: 0.9,
                    friction: 0.005,
                    render: {
                        fillStyle: this.color,
                        strokeStyle: "1px solid " + this.stroke
                    },
                    isStatic: this.isStatic,
                    angle: this.rotation,
                    frictionAir: 0
                }      
            );
        }

        return this.matterJsBody;
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

    getArea() {
        const vertices = this.getMatterVertices();
        let area = 0;
        for (let i = 0; i < vertices.length - 1; i++) {
            let v = vertices[i];
            let vn = vertices[i + 1];
            area += (v.x * vn.y - vn.x * v.y) / 2;
        }

        return area;
    }
}

export default PolyProps