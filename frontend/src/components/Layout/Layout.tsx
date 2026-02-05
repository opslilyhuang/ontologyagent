import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Upload, Layers, MessageCircle } from 'lucide-react'
import { useT } from '@/i18n'

export function Layout({ children }: { children: ReactNode }) {
  const { lang, setLang, t } = useT()

  const NAV = [
    { to: '/',           key: 'layout.nav.dashboard',   Icon: LayoutDashboard },
    { to: '/ingest',     key: 'layout.nav.ingest',      Icon: Upload },
    { to: '/ontologies', key: 'layout.nav.ontologies',  Icon: Layers },
    { to: '/qa',         key: 'layout.nav.qa',          Icon: MessageCircle },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* ── Sidebar ── */}
      <aside className="w-56 bg-slate-950 flex flex-col flex-shrink-0">
        {/* Brand */}
        <div className="px-4 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#818cf8,#a78bfa)' }}>
            <Layers size={15} className="text-white" />
          </div>
          <div>
            <p className="text-white text-sm font-semibold">Ontology Agent</p>
            <p className="text-slate-500 text-xs">{t('layout.brand.sub')}</p>
          </div>
        </div>

        <div className="mx-4 h-px bg-slate-800"></div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ' +
                (isActive ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900')
              }
            >
              <Icon size={16} />
              {t(key)}
            </NavLink>
          ))}
        </nav>

        {/* Status */}
        <div className="px-4 py-3.5 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span className="text-slate-500 text-xs">{t('layout.status')}</span>
            <span className="ml-auto text-slate-600 text-xs">v0.1</span>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-8 flex-shrink-0">
          <span className="text-slate-400 text-sm">{t('layout.header.desc')}</span>
          <div className="ml-auto flex items-center gap-3">
            {/* Lang toggle */}
            <div className="flex rounded-full overflow-hidden border border-slate-200 bg-slate-100">
              <button
                onClick={() => setLang('zh')}
                className={`px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  lang === 'zh' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                中文
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  lang === 'en' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                EN
              </button>
            </div>

            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Online
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-custom min-h-0">
          {children}
        </main>
      </div>
    </div>
  )
}
