import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Activity,
  LayoutDashboard,
  Cloud,
  Server,
  DollarSign,
  TrendingDown,
  Sliders,
  History,
  Settings,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  User as UserIcon
} from 'lucide-react';

const MainLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { section: 'Dashboard', items: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }] },
    {
      section: 'Azure',
      items: [
        { label: 'Azure Connections', path: '/azure', icon: Cloud },
        { label: 'Virtual Machines', path: '/vms', icon: Server }
      ]
    },
    {
      section: 'Cost',
      items: [
        { label: 'Cost Overview', path: '/costs', icon: DollarSign },
        { label: 'Savings', path: '/savings', icon: TrendingDown }
      ]
    },
    {
      section: 'Optimization',
      items: [
        { label: 'Policy', path: '/optimization', icon: Sliders },
        { label: 'Action History', path: '/actions', icon: History }
      ]
    },
    {
      section: 'Settings',
      items: [{ label: 'Settings', path: '/settings', icon: Settings }]
    }
  ];

  if (user?.role === 'ADMIN') {
    navItems.push({
      section: 'Admin',
      items: [{ label: 'Admin Panel', path: '/admin', icon: ShieldCheck }]
    });
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff'
          }}>
            <Activity size={20} />
          </div>
          <span className="sidebar-brand">CloudPulse</span>
          <button 
            className="mobile-close-btn"
            onClick={() => setMobileOpen(false)}
            style={{ display: 'none', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: 'auto' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-nav">
          {navItems.map((group, idx) => (
            <div key={idx} style={{ marginBottom: '1.25rem' }}>
              <div className="nav-section-label">{group.section}</div>
              {group.items.map((item) => {
                const IconComponent = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <IconComponent size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Footer User Card */}
        <div style={{
          padding: '1rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          backgroundColor: 'var(--bg-primary)'
        }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary)',
            fontWeight: '600'
          }}>
            {user?.name ? user.name.charAt(0).toUpperCase() : <UserIcon size={18} />}
          </div>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name || 'User'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.email}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Wrapper */}
      <div className="main-wrapper">
        {/* Top Header Navbar */}
        <header className="top-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button 
              className="menu-toggle-btn"
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <Menu size={24} />
            </button>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              CloudPulse SaaS Dashboard
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className={`badge ${user?.role === 'ADMIN' ? 'badge-warning' : 'badge-info'}`}>
              {user?.role || 'USER'}
            </span>
            <button className="btn btn-secondary" onClick={handleLogout} style={{ padding: '0.4rem 0.875rem' }}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
