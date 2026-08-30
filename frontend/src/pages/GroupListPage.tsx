/**
 * GroupListPage — the caller's groups, each with their own net position in it
 * (SPEC §14: "the user's groups plus their own net position in each").
 *
 * `GET /api/groups` returns the groups but no balances, so we fetch
 * `/api/groups/{id}/balances` per group and pick out this user's row. Green =
 * others owe you, red = you owe, neutral = settled.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../auth/auth-context'
import { ApiError, groupsApi } from '../lib/api'
import type { Group } from '../lib/api'
import { formatMoney, negateMoney, parseMoney, ZERO } from '../lib/money'
import type { Money } from '../lib/money'

interface GroupRow {
  group: Group
  net: Money
}

function NetPosition({ net }: { net: Money }) {
  if (net === ZERO) {
    return <span className="net net-zero">ยอดครบแล้ว</span>
  }
  if (net > ZERO) {
    return <span className="net net-pos">คุณควรได้รับคืน {formatMoney(net)}</span>
  }
  return <span className="net net-neg">คุณติดหนี้ {formatMoney(negateMoney(net))}</span>
}

export function GroupListPage() {
  const { user, logout } = useAuth()
  const [rows, setRows] = useState<GroupRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const groups = await groupsApi.list()
        const withNet = await Promise.all(
          groups.map(async (group): Promise<GroupRow> => {
            const { balances } = await groupsApi.balances(group.id)
            const mine = balances.find((b) => b.user_id === user?.id)
            return { group, net: mine ? parseMoney(mine.net_balance) : ZERO }
          }),
        )
        if (!cancelled) {
          setRows(withNet)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.detail : 'โหลดรายการกลุ่มไม่สำเร็จ')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user?.id, refreshTick])

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)
    try {
      await groupsApi.create(name.trim())
      setName('')
      setRefreshTick((n) => n + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'สร้างกลุ่มไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="page groups-page">
      <header className="page-head">
        <div className="page-head-titles">
          <h1>กลุ่มของฉัน</h1>
          <p className="page-subtitle">ภาพรวมยอดคงเหลือของคุณในแต่ละกลุ่ม</p>
        </div>
        <button type="button" onClick={logout}>
          ออกจากระบบ
        </button>
      </header>

      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <form className="inline-form" onSubmit={onCreate}>
        <input
          aria-label="ชื่อกลุ่มใหม่"
          placeholder="ชื่อกลุ่มใหม่"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" disabled={creating || name.trim() === ''}>
          {creating ? 'กำลังสร้าง…' : '+ กลุ่มใหม่'}
        </button>
      </form>

      {rows === null && error === null && <p className="centered-status">กำลังโหลด…</p>}

      {rows !== null && rows.length === 0 && (
        <p className="centered-status">ยังไม่มีกลุ่ม — สร้างกลุ่มจากด้านบนเพื่อเริ่มต้น</p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="group-list">
          {rows.map(({ group, net }) => (
            <li key={group.id}>
              <Link to={`/groups/${group.id}`}>{group.name}</Link>
              <NetPosition net={net} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
