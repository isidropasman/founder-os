'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  inspectIngestManifest,
  runIngestManifest,
  type IngestActionResult,
  type IngestPreview,
} from './actions.ts'

const INITIAL: IngestActionResult | null = null

async function submit(_: IngestActionResult | null, formData: FormData): Promise<IngestActionResult> {
  return runIngestManifest(
    String(formData.get('manifest') ?? ''),
    String(formData.get('manifest-checksum') ?? ''),
    String(formData.get('corpus-checksum') ?? ''),
  )
}

export function IngestConsole() {
  const [result, action, pending] = useActionState(submit, INITIAL)
  const [manifest, setManifest] = useState('')
  const [preview, setPreview] = useState<IngestPreview | null>(null)
  const [checking, startTransition] = useTransition()
  const approved = preview?.ok === true && preview.sources.length > 0 && preview.skipped.length === 0

  function review(): void {
    startTransition(async () => {
      setPreview(await inspectIngestManifest(manifest))
    })
  }

  return (
    <form action={action} className="ingest-form">
      <input type="hidden" name="manifest-checksum" value={preview?.ok ? preview.manifestChecksum : ''} />
      <input type="hidden" name="corpus-checksum" value={preview?.ok ? preview.corpusChecksum : ''} />
      <label className="field-label" htmlFor="manifest">Local manifest path</label>
      <div className="search">
        <input
          className="input"
          id="manifest"
          name="manifest"
          value={manifest}
          onChange={(event) => { setManifest(event.target.value); setPreview(null) }}
          placeholder="knowledge/sources/author/manifest.yaml"
          required
        />
        <button className="btn btn--quiet" type="button" onClick={review} disabled={!manifest || checking}>{checking ? 'Reviewing…' : 'Review manifest'}</button>
        <button className="btn" type="submit" disabled={!approved || pending}>{pending ? 'Indexing…' : 'Ingest approved sources'}</button>
      </div>
      {preview?.ok ? (
        <div className="ingest-preview">
          {preview.sources.map((source) => (
            <div key={source.id}>
              <p className="meta">
                {source.id} · {source.policy.status} via {source.policy.method} · {source.policy.redistribution} · {source.checksumState} checksum · {source.checksum}
                {source.indexedChecksum ? ` · indexed ${source.indexedChecksum}` : ''}
              </p>
              {source.passages.map((passage) => (
                <p className="meta" key={passage.ordinal}>Passage {passage.ordinal + 1}: {passage.text}</p>
              ))}
            </div>
          ))}
          {preview.skipped.map((source) => <p className="meta ingest-preview__skip" key={source.sourceId}>{source.sourceId} · {source.reason}</p>)}
        </div>
      ) : null}
      {preview && !preview.ok ? <p className="quiet quiet--alert">{preview.message}</p> : null}
      {result ? (
        result.ok ? (
          <p className="quiet">Indexed {result.report.claims} passages across {result.report.sourceVersions} source versions.</p>
        ) : <p className="quiet quiet--alert">{result.message}</p>
      ) : <p className="quiet">The path is read locally. Sources under review, blocked, or missing from disk are never indexed.</p>}
    </form>
  )
}
