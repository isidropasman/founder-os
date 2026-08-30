'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Today' },
  { href: '/ask', label: 'Ask' },
  { href: '/knowledge', label: 'Library' },
  { href: '/context', label: 'Company' },
  { href: '/setup', label: 'Setup' },
]

export function Masthead() {
  const pathname = usePathname()

  return (
    <header className="top">
      <div className="top__inner">
        <Link href="/" className="mark">
          FounderOS
        </Link>
        <nav className="tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={pathname === tab.href ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
