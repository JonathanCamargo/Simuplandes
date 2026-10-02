import { Line } from "react-konva";
import { addVectors, multiplyVector, rotateVector, unitVector } from "constraint-solver-js";

/**
 * 
 * @param {{
 *  start: {x: number, y: number}
 *  end: {x: number, y: number},
 *  color: string
 * }} props 
 * @returns 
 */
function KonvaArrow(props) {
    const vector = {
        x: (props.end.x - props.start.x),
        y: (props.end.y - props.start.y)
    };

    let tip1End = rotateVector(multiplyVector(unitVector(vector), -15), 0.7);
    tip1End = addVectors(props.end, tip1End);
    let tip2End = rotateVector(multiplyVector(unitVector(vector), -15), -0.7);
    tip2End = addVectors(props.end, tip2End);
    const tipStart = props.end;
    
    return (
        <>
            <Line
                points={[props.start.x, props.start.y, props.end.x, props.end.y]}
                stroke={props.color ? props.color : "black"}
                strokeWidth={5}
                onClick={props.onClick}
            />
            <Line
                points={[tipStart.x, tipStart.y, tip1End.x, tip1End.y]}
                stroke={props.color ? props.color : "black"}
                strokeWidth={5}
                onClick={props.onClick}
            />
            <Line
                points={[tipStart.x, tipStart.y, tip2End.x, tip2End.y]}
                stroke={props.color ? props.color : "black"}
                strokeWidth={5}
                onClick={props.onClick}
            />
        </>
    )
}

export default KonvaArrow;