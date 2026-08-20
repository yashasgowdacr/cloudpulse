import React, { useState, useEffect, useCallback } from 'react';
import { azureConnectionService } from '../services/azureConnectionService';
import {
  Cloud,
  Plus,
  ShieldCheck,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  X,
  RefreshCw,
  Info,
  Check,
  Copy
} from 'lucide-react';

const GUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidGuid(val) {
  return typeof val === 'string' && GUID_REGEX.test(val.trim());
}

const AzureConnections = () => {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Selected Connection for multi-subscription support
  const [selectedConnectionId, setSelectedConnectionId] = useState('');

  // Add Connection Modal & Form State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Form Fields
  const [connectionName, setConnectionName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  // Disconnect Confirmation Modal State
  const [disconnectingConn, setDisconnectingConn] = useState(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  // Fetch Connections List
  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await azureConnectionService.getAzureConnections();
      const list = data.connections || [];
      setConnections(list);

      // Default selectedConnectionId to first active connection if not already set
      const activeList = list.filter((c) => c.status === 'ACTIVE');
      if (activeList.length > 0 && !selectedConnectionId) {
        setSelectedConnectionId(activeList[0].id);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Failed to load Azure connections.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedConnectionId]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Form Reset Helper (Crucial for Secret Memory Safety)
  const resetForm = () => {
    setConnectionName('');
    setTenantId('');
    setSubscriptionId('');
    setClientId('');
    setClientSecret(''); // Immediately clear secret from state
    setShowSecret(false);
    setFormError('');
  };

  const handleCloseAddModal = () => {
    resetForm();
    setIsAddOpen(false);
  };

  // Submit Add Connection Form
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const trimmedName = connectionName.trim();
    const trimmedTenant = tenantId.trim();
    const trimmedSub = subscriptionId.trim();
    const trimmedClient = clientId.trim();

    // Client-side Validation
    if (!trimmedName) {
      setFormError('Connection Name is required.');
      return;
    }
    if (trimmedName.length > 100) {
      setFormError('Connection Name must not exceed 100 characters.');
      return;
    }
    if (!isValidGuid(trimmedTenant)) {
      setFormError('Tenant ID must be a valid GUID format (e.g. 00000000-0000-0000-0000-000000000000).');
      return;
    }
    if (!isValidGuid(trimmedSub)) {
      setFormError('Subscription ID must be a valid GUID format (e.g. 00000000-0000-0000-0000-000000000000).');
      return;
    }
    if (!isValidGuid(trimmedClient)) {
      setFormError('Client ID must be a valid GUID format (e.g. 00000000-0000-0000-0000-000000000000).');
      return;
    }
    if (!clientSecret) {
      setFormError('Client Secret is required.');
      return;
    }

    setFormLoading(true);

    try {
      // Backend validates credentials against Azure API before inserting
      await azureConnectionService.createAzureConnection({
        connectionName: trimmedName,
        tenantId: trimmedTenant,
        subscriptionId: trimmedSub,
        clientId: trimmedClient,
        clientSecret
      });

      // Clear secret from React memory immediately
      resetForm();
      setIsAddOpen(false);
      setSuccessMsg('Azure connection added and validated successfully.');

      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchConnections();
    } catch (err) {
      if (err.response?.status === 409) {
        setFormError('This Azure subscription is already connected to your CloudPulse account.');
      } else if (err.response?.status === 400) {
        const detail = err.response.data?.details ? ` (${err.response.data.details})` : '';
        setFormError(`Unable to validate Azure credentials. Please check your Tenant ID, Subscription ID, Client ID and Client Secret.${detail}`);
      } else {
        const msg = err.response?.data?.error || err.response?.data?.message || 'Failed to add Azure connection.';
        setFormError(msg);
      }
    } finally {
      setFormLoading(false);
    }
  };

  // Soft Disconnect Handler
  const handleConfirmDisconnect = async () => {
    if (!disconnectingConn) return;
    setDisconnectLoading(true);
    try {
      await azureConnectionService.disconnectAzureConnection(disconnectingConn.id);
      setSuccessMsg(`Connection "${disconnectingConn.connectionName}" disconnected successfully.`);
      setTimeout(() => setSuccessMsg(''), 4000);

      // Update list in state
      setConnections((prev) =>
        prev.map((c) => (c.id === disconnectingConn.id ? { ...c, status: 'DISCONNECTED' } : c))
      );

      setDisconnectingConn(null);
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Failed to disconnect Azure connection.';
      setError(msg);
    } finally {
      setDisconnectLoading(false);
    }
  };

  // Helper for Status Badge Rendering
  const renderStatusBadge = (status) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="badge badge-success">Connected</span>;
      case 'DISCONNECTED':
        return <span className="badge badge-warning">Disconnected</span>;
      case 'INVALID_CREDENTIALS':
        return <span className="badge badge-error">Credentials Invalid</span>;
      case 'DISABLED':
        return <span className="badge badge-error">Disabled</span>;
      default:
        return <span className="badge badge-info">{status}</span>;
    }
  };

  const activeConnections = connections.filter((c) => c.status === 'ACTIVE');

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            Azure Connections
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Register & manage Azure Service Principal credentials with AES-256-GCM encryption
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={fetchConnections} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinner' : ''} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            <span>Refresh</span>
          </button>
          <button className="btn btn-primary" onClick={() => { resetForm(); setIsAddOpen(true); }}>
            <Plus size={18} />
            <span>Add Connection</span>
          </button>
        </div>
      </div>

      {/* Safety Notice Banner */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem 1.25rem',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.875rem'
      }}>
        <div style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>
          <ShieldCheck size={24} />
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Azure Safety Commitment:</strong> CloudPulse uses your Azure Service Principal to monitor resources and calculate optimization opportunities. Credentials are stored using AES-256-GCM encryption and plaintext secrets are never exposed in JavaScript or APIs.
        </div>
      </div>

      {/* Success Notification Alert */}
      {successMsg && (
        <div style={{
          backgroundColor: 'var(--status-success-bg)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          color: 'var(--status-success)',
          fontSize: '0.875rem'
        }}>
          <CheckCircle2 size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Error Notification Alert */}
      {error && (
        <div style={{
          backgroundColor: 'var(--status-error-bg)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          color: 'var(--status-error)',
          fontSize: '0.875rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Multiple Active Connections Selector Bar */}
      {activeConnections.length > 1 && (
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Cloud size={20} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' }}>
              Active Azure Subscription Context:
            </span>
          </div>

          <div style={{ minWidth: '280px' }}>
            <select
              value={selectedConnectionId}
              onChange={(e) => setSelectedConnectionId(e.target.value)}
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--accent-primary)', fontWeight: '500' }}
            >
              {activeConnections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.connectionName} ({conn.subscriptionId})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Main Connection Table / Cards */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Cloud size={22} style={{ color: 'var(--accent-primary)' }} />
            <span className="card-title">Registered Azure Subscriptions</span>
          </div>
          <span className="badge badge-info">{connections.length} Total</span>
        </div>

        {loading ? (
          <div className="loading-center" style={{ padding: '3rem' }}>
            <div className="spinner"></div>
            <p style={{ fontSize: '0.875rem' }}>Loading Azure connections...</p>
          </div>
        ) : connections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', margin: '0 auto 1rem' }}>
              <Cloud size={28} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
              No Azure subscriptions connected
            </h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0 auto 1.5rem', fontSize: '0.875rem' }}>
              CloudPulse uses your Azure Service Principal to monitor virtual machine resources and calculate real optimization opportunities.
            </p>
            <button className="btn btn-primary" onClick={() => { resetForm(); setIsAddOpen(true); }}>
              <Plus size={18} />
              <span>Add Azure Connection</span>
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Connection Name</th>
                  <th>Subscription ID</th>
                  <th>Tenant ID</th>
                  <th>Client ID</th>
                  <th>Status</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((conn) => (
                  <tr key={conn.id}>
                    <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                      {conn.connectionName}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      {conn.subscriptionId}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {conn.tenantId}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {conn.clientId}
                    </td>
                    <td>{renderStatusBadge(conn.status)}</td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {new Date(conn.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      {conn.status === 'ACTIVE' ? (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', color: 'var(--status-error)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                          onClick={() => setDisconnectingConn(conn)}
                        >
                          <Trash2 size={14} />
                          <span>Disconnect</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No Action</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Azure Connection Modal */}
      {isAddOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: '560px',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.375rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                Add Azure Connection
              </h2>
              <button
                onClick={handleCloseAddModal}
                disabled={formLoading}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Enter your Azure Service Principal credentials. Credentials will be validated against Azure APIs before saving.
            </p>

            {formError && (
              <div style={{
                backgroundColor: 'var(--status-error-bg)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                color: 'var(--status-error)',
                fontSize: '0.875rem'
              }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                  Connection Name (Max 100 characters)
                </label>
                <input
                  type="text"
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  placeholder="e.g. Production Azure Subscription"
                  required
                  disabled={formLoading}
                  maxLength={100}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                  Tenant ID (GUID Format)
                </label>
                <input
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  disabled={formLoading}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                  Subscription ID (GUID Format)
                </label>
                <input
                  type="text"
                  value={subscriptionId}
                  onChange={(e) => setSubscriptionId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  disabled={formLoading}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                  Client ID / Application ID (GUID Format)
                </label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                  disabled={formLoading}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                  Client Secret
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="••••••••••••••••••••••••"
                    required
                    disabled={formLoading}
                    style={{ paddingRight: '2.5rem', fontFamily: 'var(--font-mono)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    tabIndex={-1}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0.25rem'
                    }}
                    title={showSecret ? 'Hide secret' : 'Show secret'}
                  >
                    {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={handleCloseAddModal} disabled={formLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={formLoading}>
                  {formLoading ? (
                    <>
                      <div className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }}></div>
                      <span>Validating Azure credentials...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      <span>Save & Validate Connection</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      {disconnectingConn && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: '480px',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Disconnect this Azure subscription from CloudPulse?
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              CloudPulse will stop using <strong style={{ color: 'var(--text-primary)' }}>"{disconnectingConn.connectionName}"</strong> for resource monitoring and optimization. The connection record will remain in your account audit history as DISCONNECTED.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setDisconnectingConn(null)}
                disabled={disconnectLoading}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmDisconnect}
                disabled={disconnectLoading}
              >
                {disconnectLoading ? (
                  <>
                    <div className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }}></div>
                    <span>Disconnecting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>Disconnect Subscription</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AzureConnections;
