import CircleProps from "../Props/CircleProps";

class CircleTool {
    constructor(worldProps, setLabelText, onToolDone, updateEditor) {
        this.setLabelText = setLabelText;
        this.worldProps = worldProps;
        this.onToolDone = onToolDone;
        this.updateEditor = updateEditor;

        this.state = "initial";
        this.setLabelText(this.getLabelText());
        this.circle = new CircleProps([0,0], 0);
        worldProps.addBody(this.circle);
    }

    handleClick(e) {
        if (this.state === "initial") {
            const center = [e.evt.clientX, e.evt.clientY];
            this.circle.center = center;
            this.state = "centerDefined";
            this.setLabelText(this.getLabelText());
        } else if (this.state === "centerDefined") {
            this.state = "done";
            const x1 = this.circle.center[0]
            const y1 = this.circle.center[1]
            const x2 = e.evt.clientX;
            const y2 = e.evt.clientY;
            const rad = Math.sqrt(Math.pow((x2 - x1), 2) + Math.pow((y2 - y1), 2))
            this.circle.radius = rad;
            this.onToolDone();
        }
    }

    handleMouseMove(e) {
        if (this.state === "centerDefined") {
            const x1 = this.circle.center[0]
            const y1 = this.circle.center[1]
            const x2 = e.evt.clientX;
            const y2 = e.evt.clientY;
            const rad = Math.sqrt(Math.pow((x2 - x1), 2) + Math.pow((y2 - y1), 2))
            this.circle.radius = rad;
            this.updateEditor();
        }
    }

    getBody() {
        return this.circle;
    }

    isDone() {
        return this.state === "done";
    }

    getLabelText() {
        if (this.state === "initial") {
            return "Seleccione el centro del circulo";
        } else if (this.state === "centerDefined") {
            return "Seleccione el radio del circulo";
        } else {
            return "";
        }
    }

    abort() {
        this.worldProps.removeBody(this.circle);
    }
}

export default CircleTool;