import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Settings as SettingsIcon, User, Shield } from 'lucide-react';

const Settings = () => {
  const { user } = useAuth();

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
          Account & Profile Settings
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          User identity and tenant profile management
        </p>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <User size={24} style={{ color: 'var(--accent-primary)' }} />
            <span className="card-title">User Profile</span>
          </div>
          <span className={`badge ${user?.role === 'ADMIN' ? 'badge-warning' : 'badge-info'}`}>
            {user?.role || 'USER'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>
              Full Name
            </label>
            <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              {user?.name || 'N/A'}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>
              Email Address
            </label>
            <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              {user?.email || 'N/A'}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>
              Account Status
            </label>
            <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--status-success)', marginTop: '0.25rem' }}>
              {user?.status || 'ACTIVE'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
