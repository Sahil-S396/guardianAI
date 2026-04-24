import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useHospital } from '../../contexts/HospitalContext';

const navItems = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    path: '/rooms',
    label: 'Rooms',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    path: '/staff',
    label: 'Staff',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.768-.231-1.48-.634-2.07M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.768.231-1.48.634-2.07m0 0a5.002 5.002 0 019.332 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    path: '/drill',
    label: 'Drill Mode',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    drill: true,
  },
  {
    path: '/map-editor',
    label: 'Map Editor',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { drillMode } = useHospital();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <aside className="w-60 shrink-0 flex flex-col border-r border-white/[0.07] bg-navy-800 overflow-y-auto">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent-red/20 border border-accent-red/30">
            <svg className="w-4 h-4 text-accent-red" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide">GuardianAI</h1>
            <p className="text-[10px] text-white/40 font-medium uppercase tracking-widest">Safety Platform</p>
          </div>
        </div>
      </div>

      {/* Drill mode banner */}
      {drillMode && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-accent-amber/10 border border-accent-amber/30 flex items-center gap-2">
          <span className="glow-dot-amber animate-ping-slow" />
          <span className="text-xs font-semibold text-accent-amber">DRILL ACTIVE</span>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-item ${isActive ? 'active' : ''} ${item.drill && drillMode ? 'text-accent-amber border border-accent-amber/30 bg-accent-amber/10' : ''}`
            }
          >
            <span className={item.drill ? 'text-accent-amber' : ''}>{item.icon}</span>
            {item.label}
            {item.drill && drillMode && (
              <span className="ml-auto w-2 h-2 rounded-full bg-accent-amber animate-ping-slow" />
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className="px-3 pb-4 pt-3 border-t border-white/[0.07] space-y-2">
        {user && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5">
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName} className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-accent-blue/30 flex items-center justify-center text-xs font-bold text-accent-blue">
                {user.displayName?.[0] ?? user.email?.[0] ?? '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.displayName ?? 'User'}</p>
              <p className="text-[10px] text-white/40 truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          id="sidebar-logout-btn"
          onClick={handleLogout}
          className="sidebar-item w-full text-red-400/80 hover:text-accent-red hover:bg-accent-red/10"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
