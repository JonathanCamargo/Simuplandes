import React, { useRef } from 'react';
import Editor from './components/editor/Editor';
import './App.css';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Player from './components/player/Player';
import WorldProps from './logic/Props/WorldProps';

function App() {
  const worldProps = useRef(new WorldProps());

  return (
    <MemoryRouter initialEntries={["/editor"]}>
      <Routes>
        <Route path='editor' element={
          <Editor
            worldProps={worldProps}
          />
        }/>
        <Route path='player' element={<Player worldProps={worldProps}/>} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
