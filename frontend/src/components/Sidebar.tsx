import React, { useState } from 'react';
import {
  Boxes, LogOut, Menu, X, MapPin, Package, ClipboardList, Inbox,
  BarChart3, Camera, Users as UsersIcon, Compass, Briefcase,
} from 'lucide-react';
import { UserAccount } from '../types';

interface SidebarProps {
  currentUser: UserAccount;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  pendingRequestCount: number;
  outCount: number;
}

const ICONS: Record<string, React.ElementType> = {
  sites: MapPin,
  inventory: Package,
  assignments: ClipboardList,
  requests: Inbox,
  reports: BarChart3,
  shootreport: Camera,
  users: UsersIcon,
  mysites: Compass,
  available: MapPin,
  mywork: Briefcase,
};

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

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser, activeTab, onTabChange, onLogout, onOpenProfile, pendingRequestCount, outCount,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const tabs = TABS[currentUser.role] || [];

  const nav = (
    <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
      {tabs.map(t => {
        const Icon = ICONS[t.id] || Package;
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => { onTabChange(t.id); setMobileOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
              active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">{t.label}</span>
            {t.id === 'requests' && pendingRequestCount > 0 && (
              <span className="bg-amber-500 text-slate-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingRequestCount}</span>
            )}
            {t.id === 'inventory' && outCount > 0 && (
              <span className="bg-slate-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{outCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="p-3 border-t border-slate-800 space-y-1">
      <button
        onClick={onOpenProfile}
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 transition text-left"
        title="My profile"
      >
        <span className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-xs font-bold text-white">
          {currentUser.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-white truncate">{currentUser.name}</span>
          <span className="block text-[10px] text-slate-400 truncate">{currentUser.role}</span>
        </span>
      </button>
      <button
        onClick={onLogout}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-300 hover:bg-slate-800 transition"
      >
        <LogOut className="w-4 h-4" /> Sign out
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center"><Boxes className="w-4.5 h-4.5" /></div>
          <span className="text-sm font-bold tracking-tight">Site &amp; Inventory</span>
        </div>
        <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg hover:bg-slate-800" title="Open menu">
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <div className="relative w-72 max-w-[80vw] bg-slate-900 text-white flex flex-col h-full shadow-xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center"><Boxes className="w-4.5 h-4.5" /></div>
                <span className="text-sm font-bold tracking-tight">Site &amp; Inventory</span>
              </div>
              <button onClick={() => setMobileOpen(false)} title="Close menu" className="p-1.5 rounded-lg hover:bg-slate-800"><X className="w-5 h-5" /></button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 md:shrink-0 bg-slate-900 text-white h-screen sticky top-0">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center"><Boxes className="w-5 h-5" /></div>
          <div>
            <h1 className="text-sm font-bold tracking-tight leading-tight">Site &amp; Inventory</h1>
            <p className="text-[10px] text-slate-400 leading-tight">Manager</p>
          </div>
        </div>
        {nav}
        {footer}
      </aside>
    </>
  );
};
