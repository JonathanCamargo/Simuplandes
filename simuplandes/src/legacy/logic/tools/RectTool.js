import RectProps from "../Props/RectProps";

class RectTool {
    constructor(worldProps, setLabelText, onToolDone, updateEditor) {
        this.worldProps = worldProps;
        this.setLabelText = setLabelText;
        this.onToolDone = onToolDone;
        this.updateEditor = updateEditor;

        this.state = "initial";
        this.body = new RectProps([0,0], 0,0);
        worldProps.addBody(this.body);
        this.setLabelText(this.getLabelText());
    }

    handleClick(e) {
        if (this.state === "initial") {
            this.state = "centerDefined";
            const origin = [e.evt.clientX, e.evt.clientY];
            this.body.origin = origin;
            this.setLabelText(this.getLabelText());
        } else if (this.state === "centerDefined") {
            this.state = "done";
            const x1 = this.body.origin[0]
            const y1 = this.body.origin[1]
            const x2 = e.evt.clientX;
            const y2 = e.evt.clientY;
            this.body.width = x2 - x1;
            this.body.height = y2 - y1;
            this.onToolDone();
        }
    }

    handleMouseMove(e) {
        if (this.state === "centerDefined") {
            const x1 = this.body.origin[0]
            const y1 = this.body.origin[1]
            const x2 = e.evt.clientX;
            const y2 = e.evt.clientY;
            this.body.width = x2 - x1;
            this.body.height = y2 - y1;
            this.updateEditor();
        }
    }

    getBody() {
        return this.body;
    }

    isDone() {
        return this.state === "done";
    }

    getLabelText() {
        if (this.state === "initial") {
            return "Seleccione el centro del rectangulo";
        } else if (this.state === "centerDefined") {
            return "Seleccione ancho y alto";
        } else {
            return "";
        }
    }

    abort() {
        this.worldProps.removeBody(this.body);
    }
}

export default RectTool;