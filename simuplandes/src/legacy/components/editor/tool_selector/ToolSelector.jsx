import Css from "./ToolSelector.module.css";
import anchor_icon from "../../../assets/anchor_point.png";
import rot_icon from "../../../assets/rot_constraint.png";
import prism_icon from "../../../assets/prism_constraint.png";
import ground_icon from "../../../assets/ground.png";
import force_icon from "../../../assets/force.png";
import torque_icon from "../../../assets/torque.png";
import speed_icon from "../../../assets/speed.png";
import ang_speed_icon from "../../../assets/angular_speed.png";
import edit_icon from "../../../assets/edit.png";
import delete_icon from "../../../assets/delete.png";

/**
 * 
 * @param {{setTool: Function, currentToolName: String}} props 
 */
export default function ToolSelector(props) {
    const setTool = props.setTool;
    const curToolName = props.currentToolName;

    return (
        <div className={Css.mainDiv}>
            <p className={Css.title}>Cuerpos</p>
            <div className={Css.group}>
                <div className={Css.groupRow}>
                    <div title="Dibujar rectangulo (R)" onClick={() => setTool("rect")}>    
                        <svg width="35" height="35" xmlns="http://www.w3.org/2000/svg">
                            <rect width="30" height="30" x="2.5" y="2.5" stroke="black" fill="transparent" strokeWidth="2" />
                        </svg>
                    </div>
                    <div title="Dibujar circulo (C)" onClick={() => setTool("circle")}>
                        <svg height="35" width="35" xmlns="http://www.w3.org/2000/svg">
                            <circle r="15" cx="17.5" cy="17.5" fill="transparent" stroke="black" strokeWidth="2" />
                        </svg>
                    </div>
                </div>
                <div className={Css.groupRow}>
                    <div title="Dibujar polígono (P)" onClick={() => setTool("poly")}>    
                        <svg width="35" height="35" xmlns="http://www.w3.org/2000/svg">
                            <polygon points="32.5,17.5 25.0,30.49038105676658 10.000000000000004,30.49038105676658 2.5,17.500000000000004 9.999999999999993,4.5096189432334235 25.0,4.509618943233422"
                            fill="transparent" stroke="black" strokeWidth="2" />
                        </svg>
                    </div>
                </div>
            </div>
            <p className={Css.title}>Restricciones</p>
            <div className={Css.group}>
                <div className={Css.groupRow}>
                    <div title="Añadir punto de anclaje (A)" onClick={() => setTool("anchor")}>    
                        <img src={anchor_icon} height="30" width="30"/>
                    </div>
                    <div title="Añadir restricción rotacional (O)" onClick={() => setTool("rotConstraint")}>
                        <img src={rot_icon} height="30" width="30"/>
                    </div>
                </div>
                <div className={Css.groupRow}>
                    {/* <div title="Añadir restricción prismática" onClick={() => alert("Coming soon!")}>    
                        <img src={prism_icon} height="30" width="30"/>
                    </div> */}
                    <div title="Fijar cuerpo a tierra (F)" onClick={() => setTool("fix body")}>
                        <img src={ground_icon} height="30" width="30"/>
                    </div>
                </div>
                <div>

                </div>
            </div>
            <p className={Css.title}>Movimiento</p>
            <div className={Css.group}>
                <div className={Css.groupRow}>
                    <div title="Añadir fuerza (U)" onClick={() => setTool("force")}>    
                        <img src={force_icon} height="30" width="30"/>
                    </div>
                    <div title="Añadir torque (T)" onClick={() => setTool("torque")}>
                        <img src={torque_icon} height="30" width="30"/>
                    </div>
                </div>
                <div className={Css.groupRow}>
                    {/* <div title="Añadir velocidad (V)" onClick={() => setTool("velocity")}>    
                        <img src={speed_icon} height="30" width="30"/>
                    </div>
                    <div title="Añadir velocidad angular" onClick={() => alert("Coming soon!")}>
                        <img src={ang_speed_icon} height="30" width="30"/>
                    </div> */}
                </div>
                <div>

                </div>
            </div>
            {/* <p className={Css.title}>Modificar</p>
            <div className={Css.group}>
                <div className={Css.groupRow}>
                    <div title="Editar" onClick={() => alert("Coming soon!")}>    
                        <img src={edit_icon} height="30" width="30"/>
                    </div>
                    <div title="Eliminar" onClick={() => alert("Coming soon!")}>
                        <img src={delete_icon} height="30" width="30"/>
                    </div>
                </div>
            </div> */}
        </div>
    )
}