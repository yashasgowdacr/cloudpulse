import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Activity } from 'lucide-react';

const AuthLayout = () => {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '2rem 1rem',
      backgroundColor: 'var(--bg-primary)'
    }}>
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(14, 165, 233, 0.4)'
          }}>
            <Activity size={26} />
          </div>
          <span style={{
            fontSize: '1.75rem',
            fontWeight: '800',
            letterSpacing: '-0.03em',
            background: 'var(--accent-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            CloudPulse
          </span>
        </Link>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Multi-Tenant Azure Optimization Platform
        </p>
      </div>

      <div style={{
        width: '100%',
        maxWidth: '440px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: '2.5rem',
        boxShadow: 'var(--shadow-lg)'
      }}>
        <Outlet />
      </div>

      <div style={{ marginTop: '2rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        &copy; {new Date().getFullYear()} CloudPulse Enterprise. All rights reserved.
      </div>
    </div>
  );
};

export default AuthLayout;
