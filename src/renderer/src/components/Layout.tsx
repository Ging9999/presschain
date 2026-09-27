import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { List, Upload, Settings, type LucideIcon } from 'lucide-react'
import TorStatus from './TorStatus'

interface LayoutProps {
  children: ReactNode
}

const NAV_LINKS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Browse', icon: List, end: true },
  { to: '/upload', label: 'Upload', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export default function Layout({ children }: LayoutProps): JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base text-primary">
      <aside
        className="flex flex-col border-r border-edge bg-panel"
        style={{ width: 240, minWidth: 240 }}
      >
        <div className="px-5 pb-5 pt-6">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Press<span className="text-accent">Chain</span>
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">
            censorship-resistant archive
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-l-2 border-accent bg-black/30 text-primary'
                    : 'border-l-2 border-transparent text-muted hover:text-primary'
                ].join(' ')
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-edge p-4">
          <TorStatus />
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-base">{children}</main>
    </div>
  )
}
