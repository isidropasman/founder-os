import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="in">
      <p className="eyebrow">404</p>
      <h1>No such page.</h1>
      <p className="sub">
        Try <Link className="link" href="/">Today</Link>.
      </p>
    </div>
  )
}
