export default class VectorEditorLogic {
    constructor(vectorProps) {
        this.vectorProps = vectorProps;
        this.fields = {
            magnitude: {
                label: "Magnitude:",
                type: "text",
                description: `Force magnitude in ${this.vectorProps.type === "force" ? "N" : "m/s"}`,
                validator: (input) => {
                    if (typeof input != "string" || isNaN(input) || isNaN(parseFloat(input))) 
                        return "Magnitude must be a number";
                    if(parseFloat(input) === 0)
                        return "Magnitude cannot be 0";
    
                    return "valid";
                },
                setter: (input) => {
                    if(this.fields.magnitude.validator(input) !== "valid") {
                        throw new Error("Invalid magnitude");
                    }
                    this.vectorProps.setMagnitude(parseFloat(input));
                },
                getter: () => {
                    return this.vectorProps.getMagnitude();
                }
            },
            direction: {
                label: "Direction:",
                type: "text",
                description: "Force direction (relative to body's x axis) in radians",
                validator: (input) => {
                    if (typeof input != "string" || isNaN(input) || isNaN(parseFloat(input))) 
                        return "Direction must be a number";
    
                    return "valid";
                },
                setter: (input) => {
                    const valid = this.fields.direction.validator(input);
                    if(valid !== "valid") {
                        throw new Error("Invalid direction: " + valid);
                    }
                    this.vectorProps.setDirection(parseFloat(input));
    
                },
                getter: () => {
                    return this.vectorProps.getDirection();
                }
            },
            fixed: {
                label: "Fixed direction",
                description: "Indicates weather the force direction should be relative to the body or global",
                type: "checkbox",
                setter: (checked) => {
                    if(typeof checked !== "boolean") {
                        throw new Error("Invalid value for checked");
                    }
                    this.vectorProps.fixedDirection = checked;
                },
                getter: () => {
                    return this.vectorProps.fixedDirection;
                }
            }
        }
    }
}