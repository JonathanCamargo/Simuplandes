import { substractVectors } from "constraint-solver-js";

export default class BodyEditorLogic {
    constructor(bodyProps) {
        this.bodyProps = bodyProps;
        this.fields = {
            x: {
                label: "X:",
                type: "text",
                description: `Body's x position`,
                updateConstraints: true,
                validator: (input) => {
                    if (typeof input != "string" || isNaN(input) || isNaN(parseFloat(input))) 
                        return "Must be a number";
    
                    return "valid";
                },
                setter: (input) => {
                    if(this.fields.x.validator(input) !== "valid") {
                        throw new Error("Invalid X");
                    }

                    const curCenter = this.bodyProps.getCenter();
                    const x = parseFloat(input);
                    const newCenter = {x: x, y: curCenter.y};
                    const dif = substractVectors(newCenter, curCenter);
                    bodyProps.relativeMove(dif.x, dif.y);
                },
                getter: () => {
                    return this.bodyProps.getCenter().x;
                }
            },
            y: {
                label: "Y:",
                type: "text",
                description: `Body's y position`,
                updateConstraints: true,
                validator: (input) => {
                    if (typeof input != "string" || isNaN(input) || isNaN(parseFloat(input))) 
                        return "Must be a number";
    
                    return "valid";
                },
                setter: (input) => {
                    if(this.fields.y.validator(input) !== "valid") {
                        throw new Error("Invalid Y");
                    }

                    const curCenter = this.bodyProps.getCenter();
                    const y = parseFloat(input);
                    const newCenter = {x: curCenter.x, y: y};
                    const dif = substractVectors(newCenter, curCenter);
                    bodyProps.relativeMove(dif.x, dif.y);
                },
                getter: () => {
                    return this.bodyProps.getCenter().y;
                }
            },
            rotation: {
                label: "Rotation:",
                type: "text",
                description: `Body's rotation in radians`,
                updateConstraints: true,
                validator: (input) => {
                    if (typeof input != "string" || isNaN(input) || isNaN(parseFloat(input))) 
                        return "Must be a number";
    
                    return "valid";
                },
                setter: (input) => {
                    if(this.fields.rotation.validator(input) !== "valid") {
                        throw new Error("Invalid rotation");
                    }

                    const rot = parseFloat(input);
                    this.bodyProps.setRotation(rot);
                },
                getter: () => {
                    return this.bodyProps.getRotation();
                }
            },
            mass: {
                label: "Mass:",
                type: "text",
                description: `Body's mass in kg`,
                validator: (input) => {
                    if (typeof input != "string" || isNaN(input) || isNaN(parseFloat(input))) 
                        return "Must be a number";

                    const mass = parseFloat(input);
                    if (mass <= 0) 
                        return "Mass must be > 1";
    
                    return "valid";
                },
                setter: (input) => {
                    if(this.fields.mass.validator(input) !== "valid") {
                        throw new Error("Invalid rotation");
                    }

                    const rot = parseFloat(input);
                    this.bodyProps.setMass(rot);
                },
                getter: () => {
                    return this.bodyProps.getMass();
                }
            },
        }
    }
}