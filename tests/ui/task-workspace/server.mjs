import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),mock=`${root}mocks.jsx`;
const server=await createServer({configFile:false,root,plugins:[{name:'isolated-workspace-fixtures',enforce:'pre',resolveId(source,importer){if(importer?.endsWith('/TaskWorkspace.jsx')&&['../../contexts/AuthContext','../../hooks/usePermissions','../../firebase','../Layout/Header','../../services/firestore/taskRepository','../../services/firestore/taskWorkspaceRepository','../../services/firestore/sparkTaskWorkspaceRepository','firebase/firestore'].includes(source))return mock;}},react()],server:{host:'127.0.0.1',port:5189,fs:{allow:[fileURLToPath(new URL('../../../',import.meta.url))]}}});await server.listen();server.printUrls();
