import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import TaskWorkspace from '../../../src/components/Tasks/TaskWorkspace';
createRoot(document.getElementById('root')).render(<MemoryRouter><TaskWorkspace/></MemoryRouter>);
