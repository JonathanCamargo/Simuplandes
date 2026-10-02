/**
 * Window-level file drag-and-drop capture. While a drag that carries files is
 * over the window, `dragging` is true (drives the full-window overlay); a drop
 * reads the first file's text and hands it to `onText`. Drags that do not
 * carry files (text selections, element drags) are ignored entirely.
 */

import { useEffect, useRef, useState } from "react";

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes("Files");
}

export function useFileDrop(onText: (text: string, fileName: string) => void): {
  dragging: boolean;
} {
  const [dragging, setDragging] = useState(false);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(() => {
    function onDragOver(event: DragEvent): void {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    }
    function onDragLeave(event: DragEvent): void {
      // Only a leave that exits the window (no related target) ends the drag.
      if (event.relatedTarget === null) setDragging(false);
    }
    function onDrop(event: DragEvent): void {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file === undefined) return;
      void file.text().then((text) => onTextRef.current(text, file.name));
    }
    window.addEventListener("dragenter", onDragOver);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragOver);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return { dragging };
}
