import PolyProps from "../Props/PolyProps";

class PolyTool {
    constructor(worldProps, setLabelText, onToolDone, updateEditor) {
        this.worldProps = worldProps;
        this.setLabelText = setLabelText;
        this.onToolDone = onToolDone;
        this.updateEditor = updateEditor;

        this.state = "initial";
        this.body = new PolyProps([0,0]);
        this.setLabelText(this.getLabelText());
        this.worldProps.addBody(this.body);
    }

    handleClick(e) {
        if (this.state === "initial") {
            this.state = "centerDefined";
            const origin = [e.evt.clientX, e.evt.clientY];
            this.body.origin = origin;
            this.body.editLastPoint(origin[0], origin[1]);
            this.body.addPoint(origin[0], origin[1]);
            this.setLabelText(this.getLabelText());
        } else if (this.state === "centerDefined") {
            // next point. Used to follow mouse move
            this.body.addPoint(e.evt.clientX, e.evt.clientY);
            if(e.evt.ctrlKey) {
                this.state = "done";
                this.onToolDone();
            }
            this.updateEditor();
        }
    }

    handleMouseMove(e) {
        if (this.state === "centerDefined") {
            this.body.editLastPoint(e.evt.clientX, e.evt.clientY);
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
        if (this.state === "initial" | this.state === "centerDefined") {
            return "Seleccione un punto. Ctrl + click para terminar.";
        } else {
            return "";
        }
    }

    abort() {
        this.worldProps.removeBody(this.body);
    }
}

export default PolyTool;