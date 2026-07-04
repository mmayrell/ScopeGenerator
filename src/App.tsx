import { Route, Routes } from 'react-router-dom'
import Shell from './shell'
import Dashboard from './pages/Dashboard'
import SetsList from './pages/SetsList'
import SetDetail from './pages/SetDetail'
import NewScope from './pages/NewScope'
import ScopeView from './pages/ScopeView'
import System from './pages/System'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sets" element={<SetsList />} />
        <Route path="/sets/:id" element={<SetDetail />} />
        <Route path="/scopes/new" element={<NewScope />} />
        <Route path="/scopes/:id" element={<ScopeView />} />
        <Route path="/system" element={<System />} />
      </Route>
    </Routes>
  )
}
