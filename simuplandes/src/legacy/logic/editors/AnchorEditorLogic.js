import { substractVectors } from "constraint-solver-js";

export default class AnchorEditorLogic {
    constructor(anchorProps) {
        this.fields = {
            x: {
                label: "X:",
                type: "text",
                description: `Anchor's x position (relative to body's center)`,
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

                    const curPosition = anchorProps.getRelativePosition();
                    const x = parseFloat(input);
                    const newPos = {x: x, y: curPosition.y};
                    anchorProps.setRelativePosition(newPos.x, newPos.y);
                },
                getter: () => {
                    return anchorProps.getRelativePosition().x;
                }
            },
            y: {
                label: "Y:",
                type: "text",
                description: `Anchor's y position (relative to body's center)`,
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

                    const curPosition = anchorProps.getRelativePosition();
                    const y = parseFloat(input);
                    const newPos = {x: curPosition.x, y: y};
                    anchorProps.setRelativePosition(newPos.x, newPos.y);
                },
                getter: () => {
                    return anchorProps.getRelativePosition().y;
                }
            },
        }
    }
}