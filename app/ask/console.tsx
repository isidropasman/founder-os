'use client'

import { useState, useTransition } from 'react'
import { counsel, type Counsel as Result } from './actions.ts'
import { Answer } from './brief.tsx'

type SkillCard = { id: string; purpose: string }

export function Console({
  skills,
  initialQuery,
  initialSkill,
  credentialed,
}: {
  skills: SkillCard[]
  initialQuery: string
  initialSkill: string
  credentialed: boolean
}) {
  const [query, setQuery] = useState(initialQuery)
  const [skill, setSkill] = useState(initialSkill)
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()

  const active = skills.find((s) => s.id === skill)

  return (
    <div className="stack">
      <section className="in">
        <h1>What are you deciding?</h1>
        {active && <p className="sub">{active.purpose}</p>}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            start(async () => setResult(await counsel(query, skill, !credentialed)))
          }}
          style={{ marginTop: '2rem' }}
        >
          <div className="search">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Where should I focus this week…"
              aria-label="Your question"
              name="question"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn" type="submit" disabled={pending || !query.trim()}>
              {pending ? 'Thinking…' : 'Ask'}
            </button>
          </div>

          <div className="tags" style={{ marginTop: '0.9rem' }}>
            {skills.map((s) => (
              <button
                key={s.id}
                type="button"
                className="tag"
                aria-pressed={s.id === skill}
                onClick={() => setSkill(s.id)}
              >
                {s.id}
              </button>
            ))}
          </div>
        </form>
      </section>

      <div aria-live="polite">
        {pending && <p className="meta">Reading your record and the library…</p>}
        {result && !pending && <Answer result={result} />}
      </div>
    </div>
  )
}
