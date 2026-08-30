import type { ReactNode } from 'react'
import { Masthead } from './masthead.tsx'
import './globals.css'

export const metadata = {
  title: 'FounderOS',
  description: 'Know the one thing to do next, and where the advice came from.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        <Masthead />
        <main className="shell">{children}</main>
      </body>
    </html>
  )
}
