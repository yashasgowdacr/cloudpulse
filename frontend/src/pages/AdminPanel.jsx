import React, { useState } from 'react';
import { ShieldCheck, Play, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../services/api';

const AdminPanel = () => {
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [testMailLoading, setTestMailLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const handleRunNow = async () => {
    setTriggerLoading(true);
    setStatusMessage(null);
    try {
      const response = await api.get('/api/scheduler/run-now');
      setStatusMessage({ type: 'success', text: response.data.message || 'Optimization scan executed.' });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.response?.data?.message || 'Failed to trigger scan.' });
    } finally {
      setTriggerLoading(false);
    }
  };

  const handleTestMail = async () => {
    setTestMailLoading(true);
    setStatusMessage(null);
    try {
      const response = await api.get('/api/notifications/test');
      setStatusMessage({ type: 'success', text: response.data.message || 'Test email dispatched.' });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.response?.data?.message || 'Failed to send test email.' });
    } finally {
      setTestMailLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
          Administration Panel
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          System-wide administrative controls and operational diagnostic tools
        </p>
      </div>

      {statusMessage && (
        <div style={{
          backgroundColor: statusMessage.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-error-bg)',
          border: `1px solid ${statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          color: statusMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-error)',
          fontSize: '0.875rem'
        }}>
          {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Play size={24} style={{ color: 'var(--accent-primary)' }} />
              <span className="card-title">Manual Scheduler Trigger</span>
            </div>
            <span className="badge badge-warning">ADMIN ONLY</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            Trigger an immediate multi-tenant VM optimization scan. Obeying PostgreSQL advisory lock protection.
          </p>
          <button className="btn btn-primary" onClick={handleRunNow} disabled={triggerLoading}>
            {triggerLoading ? 'Executing Scan...' : 'Trigger Optimization Scan'}
          </button>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Send size={24} style={{ color: 'var(--status-info)' }} />
              <span className="card-title">SMTP Notification Diagnostic</span>
            </div>
            <span className="badge badge-warning">ADMIN ONLY</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            Send a diagnostic test email to the authenticated admin's email address.
          </p>
          <button className="btn btn-secondary" onClick={handleTestMail} disabled={testMailLoading}>
            {testMailLoading ? 'Sending Test...' : 'Send Test Notification'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
