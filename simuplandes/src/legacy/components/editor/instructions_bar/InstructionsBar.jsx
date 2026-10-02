import Css from "./InstructionsBar.module.css"

export default function InstructionsBar(props) {
    return (
      <div className={Css.mainDiv}>
        <div className={Css.instructionsContainer}>
          <span>{props.labelText}</span>
        </div>
      </div>  
    )
}