import AnchorProps from "../Props/AnchorProps";
import RotConstraintProps from "../Props/RotConstraintProps";
import { solveConstraints } from "../utils/ConstraintUtils";

export default class RotConstraintTool {
    constructor(worldProps, setLabelText, onToolDone) {
        this.worldProps = worldProps;
        this.setLabelText = setLabelText;
        this.onToolDone = onToolDone;
        this.constraint = new RotConstraintProps();
        this.constraint.setLength(0);
        this.state = "initial";
        this.setLabelText(this.getLabelText());
    }

    isDone() {
        if(this.state === "done") {
            return true;
        }

        return false;
    }

    /**
     * @param {AnchorProps} anchor 
     */
    handleAnchorClick(anchor) {
        if (this.state === "initial") {
            this.state = "anchorADefined";
            this.constraint.setAnchorA(anchor);
            this.setLabelText(this.getLabelText());
        } else if(this.state === "anchorADefined") {
            this.state = "done";
            this.constraint.setAnchorB(anchor);
            this.worldProps.addRotConstraint(this.constraint);
            try {
                solveConstraints(this.worldProps);
            } catch (err) {
                alert(err.message)
                this.worldProps.removeRotConstraint(this.constraint);
            }
            this.onToolDone();
        }
    }

    getLabelText() {
        if(this.state === "initial") {
            return "Seleccione el anclaje A";
        } else if(this.state === "anchorADefined") {
            return "Seleccione el anclaje B";
        }

        return "";
    }
}