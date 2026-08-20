import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

const Forbidden = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '2rem'
    }}>
      <div style={{ color: 'var(--status-error)', marginBottom: '1rem' }}>
        <ShieldAlert size={64} />
      </div>
      <h1 style={{ fontSize: '2.5rem', fontWeight: '800', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
        403 - Access Denied
      </h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', marginBottom: '2rem' }}>
        You do not have administrative privileges to view this page. This action has been logged in accordance with tenant isolation policies.
      </p>
      <Link to="/dashboard" className="btn btn-primary">
        <ArrowLeft size={18} />
        <span>Return to Dashboard</span>
      </Link>
    </div>
  );
};

export default Forbidden;
