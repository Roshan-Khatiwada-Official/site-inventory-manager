import React from 'react';
import { Boxes, RefreshCw, LogOut } from 'lucide-react';
import { UserAccount } from '../types';

interface HeaderProps {
  currentUser: UserAccount;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  isSyncing: boolean;
  pendingRequestCount: number;
  outCount: number;
}

const TABS: Record<UserAccount['role'], { id: string; label: string }[]> = {
  Admin: [
    { id: 'sites', label: 'Sites' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'requests', label: 'Requests' },
    { id: 'reports', label: 'Reports' },
    { id: 'shootreport', label: 'Shoot Report' },
    { id: 'users', label: 'Logins' },
  ],
  'Site Finder': [{ id: 'mysites', label: 'My Sites' }],
  'Data Collector': [
    { id: 'available', label: 'Available Sites' },
    { id: 'mywork', label: 'My Work' },
  ],
  'Field Worker': [
    { id: 'mysites', label: 'My Sites' },
    { id: 'available', label: 'Available Sites' },
    { id: 'mywork', label: 'My Work' },
  ],
};

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeTab,
  onTabChange,
  onLogout,
  onOpenProfile,
  isSyncing,
  pendingRequestCount,
  outCount,
}) => {
  const tabs = TABS[currentUser.role] || [];

  return (
    <header className="bg-slate-900 text-slate-100 border-b border-slate-800 sticky top-0 z-30 shadow">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">Site &amp; Inventory Manager</h1>
              <p className="text-[11px] text-slate-400">
                {currentUser.name} · <span className="text-slate-300">{currentUser.role}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border ${
                isSyncing
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                  : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
              }`}
              title="Data syncs automatically with the server"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing…' : 'Synced'}
            </span>
            <button
              onClick={onOpenProfile}
              title="My profile"
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 pl-1 pr-2.5 py-1 rounded-lg transition"
            >
              <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-[10px] font-bold text-white">
                {currentUser.name.charAt(0).toUpperCase()}
              </span>
              <span className="text-xs font-medium hidden sm:inline max-w-[110px] truncate">{currentUser.name}</span>
            </button>
            <button
              onClick={onLogout}
              title="Sign out"
              className="p-1.5 text-slate-400 hover:text-rose-300 hover:bg-slate-800 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {tabs.length > 1 && (
          <nav className="mt-3 flex items-center gap-1 bg-slate-800/70 p-1 rounded-lg border border-slate-700/60 w-fit">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`px-3 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 ${
                  activeTab === t.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                {t.label}
                {t.id === 'requests' && pendingRequestCount > 0 && (
                  <span className="bg-amber-500 text-slate-900 text-[10px] font-bold px-1.5 rounded-full">
                    {pendingRequestCount}
                  </span>
                )}
                {t.id === 'inventory' && outCount > 0 && (
                  <span className="bg-slate-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                    {outCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
};
