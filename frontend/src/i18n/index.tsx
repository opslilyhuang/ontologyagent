import { createContext, useContext, useState, ReactNode } from 'react'
import zh from './zh'
import en from './en'

type Lang = 'zh' | 'en'

const messages: Record<Lang, Record<string, string>> = { zh, en }

const STORAGE_KEY = 'ontology-agent-lang'

function readLang(): Lang {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'en' ? 'en' : 'zh'
}

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const LangContext = createContext<LangCtx | undefined>(undefined)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)

  const setLang = (l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLangState(l)
  }

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let str = messages[lang][key] ?? key
    if (vars) {
      str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
    }
    return str
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useT must be used inside <LangProvider>')
  return ctx
}
