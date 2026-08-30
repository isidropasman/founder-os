'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { persist } from './actions.ts'
import type { Field, Step, StepValues } from '../../src/setup.ts'

function blank(fields: Field[]): StepValues {
  return Object.fromEntries(fields.map((f) => [f.name, '']))
}

function Input({
  field,
  value,
  onChange,
}: {
  field: Field
  value: unknown
  onChange: (next: string) => void
}) {
  const id = `f-${field.name}-${Math.random().toString(36).slice(2, 7)}`

  if (field.kind === 'choice') {
    return (
      <div className="tags">
        {field.choices?.map((choice) => (
          <button
            key={choice}
            type="button"
            className="tag"
            aria-pressed={value === choice}
            onClick={() => onChange(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
    )
  }

  return (
    <input
      id={id}
      className="input"
      type={field.kind === 'number' ? 'number' : 'text'}
      inputMode={field.kind === 'number' ? 'numeric' : undefined}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ? `${field.placeholder}…` : undefined}
      aria-label={field.label}
      autoComplete="off"
      spellCheck={false}
    />
  )
}

export function Walkthrough({ steps, done }: { steps: Step[]; done: string[] }) {
  const [index, setIndex] = useState(() => {
    const next = steps.findIndex((s) => !done.includes(s.id))
    return next === -1 ? 0 : next
  })
  const [single, setSingle] = useState<Record<string, StepValues>>({})
  const [many, setMany] = useState<Record<string, StepValues[]>>({})
  const [saved, setSaved] = useState<string[]>(done)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  const step = steps[index]!
  const rows = many[step.id] ?? [blank(step.fields)]
  const values = single[step.id] ?? blank(step.fields)

  function setField(name: string, next: string, row?: number) {
    if (step.repeats && row !== undefined) {
      setMany((prev) => {
        const current = prev[step.id] ?? [blank(step.fields)]
        return {
          ...prev,
          [step.id]: current.map((r, i) => (i === row ? { ...r, [name]: next } : r)),
        }
      })
      return
    }
    setSingle((prev) => ({ ...prev, [step.id]: { ...values, [name]: next } }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    start(async () => {
      const payload = step.repeats ? rows : values
      const result = await persist(step.id, payload)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSaved((prev) => [...new Set([...prev, step.id])])
      if (index < steps.length - 1) setIndex(index + 1)
    })
  }

  const last = index === steps.length - 1
  const allDone = saved.length === steps.length

  return (
    <div className="stack">
      <section className="in">
        <p className="eyebrow">
          Step {index + 1} of {steps.length}
        </p>
        <h1>{step.title}</h1>
        <p className="sub">{step.unlocks}</p>
      </section>

      <form onSubmit={submit} className="in" style={{ animationDelay: '60ms' }}>
        {(step.repeats ? rows : [values]).map((row, rowIndex) => (
          <div key={rowIndex} style={{ marginBottom: step.repeats ? '2rem' : 0 }}>
            {step.repeats && rows.length > 1 && (
              <p className="meta" style={{ marginBottom: '0.5rem' }}>
                {step.repeats.noun} {rowIndex + 1}
              </p>
            )}
            {step.fields.map((field) => (
              <div key={field.name} style={{ marginBottom: '1.25rem' }}>
                <label
                  htmlFor={`f-${field.name}`}
                  style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem' }}
                >
                  {field.label}
                </label>
                <Input
                  field={field}
                  value={row[field.name]}
                  onChange={(next) => setField(field.name, next, step.repeats ? rowIndex : undefined)}
                />
                {field.because && (
                  <p className="meta" style={{ marginTop: '0.4rem' }}>
                    {field.because}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}

        {step.repeats && rows.length < step.repeats.max && (
          <button
            type="button"
            className="tag"
            onClick={() =>
              setMany((prev) => ({
                ...prev,
                [step.id]: [...(prev[step.id] ?? [blank(step.fields)]), blank(step.fields)],
              }))
            }
          >
            Add another {step.repeats.noun}
          </button>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '2rem', alignItems: 'center' }}>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Saving…' : last ? 'Finish' : 'Save & continue'}
          </button>
          {index > 0 && (
            <button type="button" className="tag" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          {!last && (
            <button type="button" className="tag" onClick={() => setIndex(index + 1)}>
              Skip for now
            </button>
          )}
        </div>

        <div aria-live="polite">
          {error && (
            <p className="quiet quiet--alert" style={{ marginTop: '1.5rem' }}>
              {error}
            </p>
          )}
          {allDone && !pending && (
            <p className="quiet" style={{ marginTop: '1.5rem' }}>
              That is enough to start. <Link className="link" href="/">See what it found</Link>.
            </p>
          )}
        </div>
      </form>

      <section className="in" style={{ animationDelay: '120ms' }}>
        <div className="rows">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="row"
              onClick={() => setIndex(i)}
              style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
            >
              <span
                className="row__dot"
                style={saved.includes(s.id) ? { background: 'var(--ink)' } : undefined}
                aria-hidden="true"
              />
              <span className="row__body">
                <span className="row__title">{s.title}</span>
              </span>
              <span className="row__aside">{saved.includes(s.id) ? 'done' : 'later'}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
