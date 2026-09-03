/**
 * InvitationsPage — the caller's own pending group invitations (SPEC §7.1,
 * Phase 14). Accept flips the invitee to ACTIVE and sends them to the group
 * they just joined; decline removes the invitation and stays here.
 *
 * A 404 from either action (already accepted/declined/removed elsewhere — a
 * race, not a mistake) just removes the row with a quiet note: the outcome
 * the user wanted — not having this invitation any more — is already true.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError, invitationsApi } from '../lib/api'
import type { InvitationOut } from '../lib/api'

type PendingAction = { groupId: string; action: 'accept' | 'decline' } | null

function formatInvitedAt(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(when)
  } catch {
    return iso.slice(0, 10)
  }
}

export function InvitationsPage() {
  const navigate = useNavigate()
  const [invitations, setInvitations] = useState<InvitationOut[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    invitationsApi
      .list()
      .then((invites) => {
        if (!cancelled) setInvitations(invites)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError ? err.detail : 'โหลดคำเชิญไม่สำเร็จ',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  function removeInvitation(groupId: string) {
    setInvitations((prev) => (prev ? prev.filter((i) => i.group_id !== groupId) : prev))
  }

  async function onAccept(groupId: string) {
    setPending({ groupId, action: 'accept' })
    setRowErrors((e) => ({ ...e, [groupId]: '' }))
    setNotice(null)
    try {
      await invitationsApi.accept(groupId)
      removeInvitation(groupId)
      navigate(`/groups/${groupId}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        removeInvitation(groupId)
        setNotice('คำเชิญนี้ไม่สามารถใช้ได้แล้ว')
      } else {
        setRowErrors((e) => ({
          ...e,
          [groupId]: err instanceof ApiError ? err.detail : 'ยอมรับคำเชิญไม่สำเร็จ',
        }))
      }
    } finally {
      setPending(null)
    }
  }

  async function onDecline(groupId: string) {
    setPending({ groupId, action: 'decline' })
    setRowErrors((e) => ({ ...e, [groupId]: '' }))
    setNotice(null)
    try {
      await invitationsApi.decline(groupId)
      removeInvitation(groupId)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        removeInvitation(groupId)
        setNotice('คำเชิญนี้ไม่สามารถใช้ได้แล้ว')
      } else {
        setRowErrors((e) => ({
          ...e,
          [groupId]: err instanceof ApiError ? err.detail : 'ปฏิเสธคำเชิญไม่สำเร็จ',
        }))
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="page invitations-page">
      <header className="page-head">
        <div className="page-head-titles">
          <h1>คำเชิญเข้าร่วมกลุ่ม</h1>
          {invitations !== null && invitations.length > 0 && (
            <p className="page-subtitle">
              ยอมรับเพื่อเข้าร่วมกลุ่มและเริ่มแบ่งค่าใช้จ่าย
            </p>
          )}
        </div>
      </header>

      {loadError !== null && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}

      {notice !== null && <p className="notice">{notice}</p>}

      {invitations === null && loadError === null && (
        <p className="centered-status">กำลังโหลด…</p>
      )}

      {invitations !== null && invitations.length === 0 && (
        <p className="centered-status">ไม่มีคำเชิญที่รอตอบรับ</p>
      )}

      {invitations !== null && invitations.length > 0 && (
        <ul className="invitation-list">
          {invitations.map((inv) => {
            const isPending = pending?.groupId === inv.group_id
            const acceptPending = isPending && pending?.action === 'accept'
            const declinePending = isPending && pending?.action === 'decline'
            return (
              <li key={inv.group_id} className="invitation-row">
                <div className="invitation-info">
                  <span className="invitation-group-name">{inv.group_name}</span>
                  <span className="muted">เชิญเมื่อ {formatInvitedAt(inv.invited_at)}</span>
                  {rowErrors[inv.group_id] && (
                    <p role="alert" className="form-error">
                      {rowErrors[inv.group_id]}
                    </p>
                  )}
                </div>
                <div className="invitation-actions">
                  <button
                    type="button"
                    onClick={() => onAccept(inv.group_id)}
                    disabled={isPending}
                  >
                    {acceptPending ? 'กำลังยอมรับ…' : 'ยอมรับ'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onDecline(inv.group_id)}
                    disabled={isPending}
                  >
                    {declinePending ? 'กำลังปฏิเสธ…' : 'ปฏิเสธ'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
