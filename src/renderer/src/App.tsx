import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { useAppStore } from './store'
import Layout from './components/Layout'
import Onboarding from './pages/Onboarding'
import Browse from './pages/Browse'
import Upload from './pages/Upload'
import Read from './pages/Read'
import Settings from './pages/Settings'
import UnlockOverlay from './components/UnlockOverlay'
import Spinner from './components/Spinner'

// HashRouter is used because the packaged app loads the renderer over file://,
// where history-based routing does not work.
function App(): React.JSX.Element {
  const gate = useAppStore((s) => s.gate)
  const refreshGate = useAppStore((s) => s.refreshGate)

  useEffect(() => {
    refreshGate()
  }, [refreshGate])

  if (gate === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-base">
        <Spinner size={28} />
      </div>
    )
  }

  if (gate === 'onboard') return <Onboarding mode="create" />
  if (gate === 'unlock') return <Onboarding mode="unlock" />

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Browse />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/read/:articleId" element={<Read />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
      <UnlockOverlay />
    </HashRouter>
  )
}

export default App
