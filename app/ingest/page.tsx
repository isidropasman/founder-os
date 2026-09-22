import { IngestConsole } from './console.tsx'

export const dynamic = 'force-dynamic'

export default function Ingest() {
  return (
    <div className="stack">
      <section className="in">
        <h1>Review before indexing.</h1>
        <p className="sub">FounderOS reads a local manifest, preserves its acquisition policy, and creates a new source version when the checksum changes.</p>
      </section>
      <section className="in"><IngestConsole /></section>
    </div>
  )
}
