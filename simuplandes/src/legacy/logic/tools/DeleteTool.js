// export default class DeleteTool {
//     constructor(setLabelText, onToolDone) {
//         this.setLabelText = setLabelText;
//         this.onToolDone = onToolDone;
//         this.state = "initial";
//     }

//     handleClick(e) {

//     }

//     getAnchor() {
//         return this.anchorPros;
//     }

//     getId() {
//         return this.id;
//     }

//     isDone() {
//         return this.state === "done";
//     }

//     getLabelText() {
//         if (this.state === "initial") {
//             return "Seleccione el cuerpo a fijar";
//         } else if(this.state === "bodySelected") {
//             return "Seleccione la posición de la fijación";
//         } else {
//             return "";
//         }
//     }

//     handleBodyClick(body) {
//         this.state = "bodySelected";
//         this.anchorPros.setBody(body);
//         this.setLabelText(this.getLabelText());
//     }
// }