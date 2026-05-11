'use client';

import { useMemo, useState } from 'react';
import type { UserAccount, UserRole, UserSession } from '@/lib/types';

const roles: UserRole[] = ['admin', 'content', 'video', 'ops', 'creator'];
type StatusFilter = 'all' | 'active' | 'disabled' | 'locked';

export function UserAdminPanel({ initialUsers, initialSessions }: { initialUsers: UserAccount[]; initialSessions: UserSession[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [sessions, setSessions] = useState(initialSessions);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'content' as UserRole });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery) || user.email.toLowerCase().includes(normalizedQuery);
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const isLocked = Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && !user.disabledAt)
        || (statusFilter === 'disabled' && Boolean(user.disabledAt))
        || (statusFilter === 'locked' && isLocked);
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [users, query, roleFilter, statusFilter]);

  const sessionsWithUsers = useMemo(() => sessions.map((session) => ({
    session,
    user: users.find((item) => item.id === session.userId)
  })), [sessions, users]);

  async function createUser() {
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/users/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(payload.error || '创建失败');
    setUsers((current) => [payload.user, ...current]);
    setForm({ name: '', email: '', password: '', role: 'content' });
    setMessage('账号已创建');
  }

  async function updateRole(userId: string, role: UserRole) {
    const response = await fetch('/api/users/update-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || '更新角色失败');
    setUsers((current) => current.map((item) => (item.id === userId ? payload.user : item)));
    setMessage('角色已更新');
  }

  async function resetPassword(userId: string) {
    const password = window.prompt('输入新的临时密码。执行后该账号会被强制登出。');
    if (!password) return;
    const response = await fetch('/api/users/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, password }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || '重置密码失败');
    setSessions((current) => current.filter((item) => item.userId !== userId));
    setMessage(`已重置密码并强制登出：${payload.user.name}`);
  }

  async function disableUser(userId: string) {
    const confirmed = window.confirm('停用后，该账号将立即失去访问权限，并强制退出当前所有会话。确定继续吗？');
    if (!confirmed) return;
    const response = await fetch('/api/users/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || '停用失败');
    setUsers((current) => current.map((item) => (item.id === userId ? payload.user : item)));
    setSessions((current) => current.filter((item) => item.userId !== userId));
    setMessage(`已停用账号：${payload.user.name}`);
  }

  async function enableUser(userId: string) {
    const response = await fetch('/api/users/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || '恢复失败');
    setUsers((current) => current.map((item) => (item.id === userId ? payload.user : item)));
    setMessage(`已恢复账号：${payload.user.name}`);
  }

  async function revokeSession(sessionId: string, userId: string) {
    const response = await fetch('/api/users/revoke-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, userId }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || '强制下线失败');
    setSessions((current) => current.filter((item) => item.id !== sessionId));
    setMessage('已强制下线该 session');
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={panelStyle}>
        <div>
          <div style={eyebrowStyle}>Create Account</div>
          <h2 style={{ margin: '8px 0 0', fontSize: 28 }}>新增团队账号</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="姓名" style={inputStyle} />
          <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="邮箱" style={inputStyle} />
          <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="初始密码" style={inputStyle} />
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} style={inputStyle}>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={createUser} disabled={busy} style={buttonStyle}>{busy ? '创建中…' : '创建账号'}</button>
          {message ? <span style={{ color: '#cbd5e1' }}>{message}</span> : null}
        </div>
      </section>

      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={eyebrowStyle}>Team Accounts</div>
            <h2 style={{ margin: '8px 0 0', fontSize: 28 }}>账号列表</h2>
          </div>
          <div style={{ color: '#94a3b8' }}>筛选后 {filteredUsers.length} / 总计 {users.length}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 0.8fr', gap: 12 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" style={inputStyle} />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)} style={inputStyle}>
            <option value="all">全部角色</option>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} style={inputStyle}>
            <option value="all">全部状态</option>
            <option value="active">启用中</option>
            <option value="disabled">已停用</option>
            <option value="locked">已锁定</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {filteredUsers.map((user) => (
            <article key={user.id} style={{ borderRadius: 18, padding: 16, background: user.disabledAt ? 'rgba(127,29,29,0.14)' : 'rgba(255,255,255,0.025)', border: '1px solid rgba(148,163,184,0.14)', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr auto auto', gap: 14, alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 18 }}>{user.name}</strong>
                  {user.disabledAt ? <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(127,29,29,0.22)', color: '#fecaca', fontSize: 12 }}>已停用</span> : <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(20,83,45,0.22)', color: '#bbf7d0', fontSize: 12 }}>启用中</span>}
                  {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() ? <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(120,53,15,0.26)', color: '#fde68a', fontSize: 12 }}>已锁定</span> : null}
                </div>
                <div style={{ marginTop: 6, color: '#94a3b8' }}>{user.email}</div>
                <div style={{ marginTop: 6, color: '#cbd5e1', fontSize: 12 }}>最近登录：{user.lastLoginAt ? formatDate(user.lastLoginAt) : '暂无'}</div>
                <div style={{ marginTop: 6, color: '#cbd5e1', fontSize: 12 }}>失败次数：{user.failedLoginAttempts || 0}</div>
                {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() ? <div style={{ marginTop: 6, color: '#fde68a', fontSize: 12 }}>锁定到：{formatDate(user.lockedUntil)}</div> : null}
                {user.disabledAt ? <div style={{ marginTop: 6, color: '#fca5a5', fontSize: 12 }}>停用时间：{formatDate(user.disabledAt)}</div> : null}
              </div>
              <div style={{ color: '#cbd5e1' }}>{formatDate(user.createdAt)}</div>
              <select value={user.role} disabled={Boolean(user.disabledAt)} onChange={(event) => updateRole(user.id, event.target.value as UserRole)} style={inputStyle}>
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <button onClick={() => resetPassword(user.id)} disabled={Boolean(user.disabledAt)} style={secondaryButtonStyle}>重置密码</button>
              {user.disabledAt ? <button onClick={() => enableUser(user.id)} style={buttonStyle}>恢复账号</button> : <button onClick={() => disableUser(user.id)} style={dangerButtonStyle}>停用账号</button>}
            </article>
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={eyebrowStyle}>Active Sessions</div>
            <h2 style={{ margin: '8px 0 0', fontSize: 28 }}>当前在线会话</h2>
          </div>
          <div style={{ color: '#94a3b8' }}>共 {sessions.length} 个 session</div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {sessionsWithUsers.length === 0 ? <div style={{ color: '#94a3b8' }}>当前没有在线 session。</div> : sessionsWithUsers.map(({ session, user }) => (
            <article key={session.id} style={{ borderRadius: 18, padding: 16, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(148,163,184,0.14)', display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 0.8fr auto', gap: 14, alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 18 }}>{user?.name || '未知用户'}</strong>
                <div style={{ marginTop: 6, color: '#94a3b8' }}>{user?.email || session.userId}</div>
                <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>session: {session.id}</div>
              </div>
              <div style={{ color: '#cbd5e1' }}>创建：{formatDate(session.createdAt)}</div>
              <div style={{ color: '#cbd5e1' }}>过期：{formatDate(session.expiresAt)}</div>
              <button onClick={() => revokeSession(session.id, session.userId)} style={dangerButtonStyle}>强制下线</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

const panelStyle = {
  borderRadius: 24,
  border: '1px solid rgba(148,163,184,0.14)',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(6,10,18,0.96) 100%)',
  padding: 20,
  display: 'grid',
  gap: 16
} as const;

const eyebrowStyle = {
  color: '#818cf8',
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase'
} as const;

const inputStyle = {
  borderRadius: 14,
  border: '1px solid rgba(148,163,184,0.18)',
  background: 'rgba(2,6,23,0.56)',
  color: '#f8fafc',
  padding: '12px 14px',
  outline: 'none'
} as const;

const buttonStyle = {
  border: 'none',
  borderRadius: 14,
  padding: '12px 14px',
  background: 'linear-gradient(135deg, #67e8f9, #06b6d4)',
  color: '#0f172a',
  fontWeight: 800,
  cursor: 'pointer'
} as const;

const secondaryButtonStyle = {
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: 14,
  padding: '12px 14px',
  background: 'rgba(255,255,255,0.03)',
  color: '#f8fafc',
  fontWeight: 700,
  cursor: 'pointer'
} as const;

const dangerButtonStyle = {
  border: '1px solid rgba(248,113,113,0.24)',
  borderRadius: 14,
  padding: '12px 14px',
  background: 'rgba(127,29,29,0.18)',
  color: '#fecaca',
  fontWeight: 700,
  cursor: 'pointer'
} as const;
