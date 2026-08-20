import React from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, ArrowLeft } from 'lucide-react';

const NotFound = () => {
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
      <div style={{ color: 'var(--accent-primary)', marginBottom: '1rem' }}>
        <HelpCircle size={64} />
      </div>
      <h1 style={{ fontSize: '2.5rem', fontWeight: '800', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
        404 - Page Not Found
      </h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', marginBottom: '2rem' }}>
        The page you are looking for does not exist or may have been moved.
      </p>
      <Link to="/dashboard" className="btn btn-primary">
        <ArrowLeft size={18} />
        <span>Return to Dashboard</span>
      </Link>
    </div>
  );
};

export default NotFound;
