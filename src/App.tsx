import { Route, Routes } from 'react-router-dom'
import Shell from './shell'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import SetsList from './pages/SetsList'
import SetDetail from './pages/SetDetail'
import NewScope from './pages/NewScope'
import ScopeView from './pages/ScopeView'
import EvidencePackets from './pages/EvidencePackets'
import ReferenceLibrary from './pages/ReferenceLibrary'
import System from './pages/System'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/scopes" element={<Dashboard />} />
        <Route path="/sets" element={<SetsList />} />
        <Route path="/sets/:id" element={<SetDetail />} />
        <Route path="/scopes/new" element={<NewScope />} />
        <Route path="/scopes/:id" element={<ScopeView />} />
        <Route path="/library" element={<ReferenceLibrary />} />
        <Route path="/packets" element={<EvidencePackets />} />
        <Route path="/system" element={<System />} />
      </Route>
    </Routes>
  )
}
