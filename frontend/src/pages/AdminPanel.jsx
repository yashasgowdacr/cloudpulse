import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Play, Send, CheckCircle2, AlertCircle,
  Users, Activity, IndianRupee, Server, Search, RefreshCw,
  Eye, UserX, UserCheck, X
} from 'lucide-react';
import api from '../services/api';
import { adminService } from '../services/adminService';

const AdminPanel = () => {
  // Metrics state
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Tenants list state
  const [tenants, setTenants] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantsLoading, setTenantsLoading] = useState(true);

  // Tenant Details Modal state
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Status update confirmation modal state
  const [statusTarget, setStatusTarget] = useState(null); // { id, name, newStatus }
  const [actionInProgress, setActionInProgress] = useState(false);

  // Trigger states
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [testMailLoading, setTestMailLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const data = await adminService.getMetrics();
      setMetrics(data);
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const fetchTenants = useCallback(async (page = 1) => {
    setTenantsLoading(true);
    try {
      const data = await adminService.getTenants({
        page,
        limit: 10,
        search,
        status: statusFilter
      });
      setTenants(data.tenants || []);
      setPagination(data.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setTenantsLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchMetrics();
    fetchTenants(1);
  }, [fetchMetrics, fetchTenants]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchTenants(1);
  };

  const handleViewDetails = async (id) => {
    setDetailsLoading(true);
    try {
      const data = await adminService.getTenantDetails(id);
      setSelectedTenant(data);
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.response?.data?.message || 'Failed to fetch tenant details.' });
    } finally {
      setDetailsLoading(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    setActionInProgress(true);
    try {
      await adminService.updateTenantStatus(statusTarget.id, statusTarget.newStatus);
      setStatusMessage({
        type: 'success',
        text: `Tenant ${statusTarget.name} status updated to ${statusTarget.newStatus}. Active sessions and refresh tokens have been invalidated.`
      });
      setStatusTarget(null);
      fetchTenants(pagination.page);
      fetchMetrics();
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.response?.data?.message || 'Failed to update tenant status.' });
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRunNow = async () => {
    setTriggerLoading(true);
    setStatusMessage(null);
    try {
      const response = await api.get('/api/scheduler/run-now');
      setStatusMessage({ type: 'success', text: response.data.message || 'Optimization scan executed.' });
      fetchMetrics();
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
      {/* Page Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <ShieldCheck size={28} style={{ color: 'var(--accent-primary)' }} />
            Administration Console
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Multi-tenant governance, platform telemetry, and operational diagnostics
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => { fetchMetrics(); fetchTenants(pagination.page); }}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={16} />
          Refresh Data
        </button>
      </div>

      {/* Global Alerts / Status */}
      {statusMessage && (
        <div style={{
          backgroundColor: statusMessage.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-error-bg)',
          border: `1px solid ${statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: statusMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-error)',
          fontSize: '0.875rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Platform Metrics KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Tenants</span>
            <Users size={18} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {metricsLoading ? '...' : (metrics?.totalTenants ?? 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {metrics?.activeTenants ?? 0} active · {metrics?.suspendedTenants ?? 0} suspended
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Cloud Connections</span>
            <Server size={18} style={{ color: 'var(--status-info)' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {metricsLoading ? '...' : (metrics?.totalCloudConnections ?? metrics?.totalAzureConnections ?? 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {metrics?.connectedSubscriptions ?? 0} Azure subscriptions linked
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Optimization Actions</span>
            <Activity size={18} style={{ color: 'var(--accent-secondary)' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {metricsLoading ? '...' : (metrics?.totalOptimizationActions ?? 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {metrics?.successfulDeallocations ?? 0} successful deallocations
          </div>
        </div>

        <div className="card" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--status-success)', textTransform: 'uppercase' }}>ESTIMATED AVOIDED COST</span>
            <IndianRupee size={18} style={{ color: 'var(--status-success)' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-success)' }}>
            ₹{metricsLoading ? '...' : (metrics?.totalEstimatedAvoidedCost?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Derived from VM runtime deallocations
          </div>
        </div>
      </div>

      {/* Tenant Directory Section */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <span className="card-title">Tenant Directory</span>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
              Manage tenant lifecycles, inspect connections, and enforce platform suspension
            </p>
          </div>
          {/* Search and Filters */}
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input"
                placeholder="Search tenant name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '2rem', width: '240px', height: '36px', fontSize: '0.85rem' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>

            <select
              className="input"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); }}
              style={{ height: '36px', fontSize: '0.85rem' }}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>

            <button type="submit" className="btn btn-secondary" style={{ height: '36px', padding: '0 0.75rem' }}>
              Search
            </button>
          </form>
        </div>

        {/* Tenant Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Tenant</th>
                <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>Connections</th>
                <th style={{ padding: '0.75rem 1rem' }}>Actions</th>
                <th style={{ padding: '0.75rem 1rem' }}>Created</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Controls</th>
              </tr>
            </thead>
            <tbody>
              {tenantsLoading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Loading tenants...
                  </td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No tenants found matching criteria.
                  </td>
                </tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.email}</div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span className={`badge ${t.role === 'ADMIN' ? 'badge-primary' : 'badge-neutral'}`} style={{ fontSize: '0.7rem' }}>
                        {t.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        className={`badge ${
                          t.status === 'ACTIVE' ? 'badge-success' : t.status === 'SUSPENDED' ? 'badge-danger' : 'badge-neutral'
                        }`}
                        style={{ fontSize: '0.7rem' }}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                      {t.azureConnectionsCount}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                      {t.actionsCount}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleViewDetails(t.id)}
                          title="View Details"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          <Eye size={14} />
                        </button>

                        {t.status === 'ACTIVE' ? (
                          <button
                            className="btn btn-danger"
                            onClick={() => setStatusTarget({ id: t.id, name: t.name, newStatus: 'SUSPENDED' })}
                            title="Suspend Tenant"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            <UserX size={14} />
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary"
                            onClick={() => setStatusTarget({ id: t.id, name: t.name, newStatus: 'ACTIVE' })}
                            title="Activate Tenant"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            <UserCheck size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} tenants
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                disabled={pagination.page <= 1}
                onClick={() => fetchTenants(pagination.page - 1)}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                Previous
              </button>
              <button
                className="btn btn-secondary"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchTenants(pagination.page + 1)}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Operational Diagnostic Tools */}
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
        System Diagnostic Tools
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Play size={24} style={{ color: 'var(--accent-primary)' }} />
              <span className="card-title">Manual Scheduler Trigger</span>
            </div>
            <span className="badge badge-warning">ADMIN ONLY</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            Trigger an immediate multi-tenant VM optimization scan. Obeying PostgreSQL advisory lock protection (ID: 987654321).
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
            Send a diagnostic test email to the authenticated admin's configured notification address.
          </p>
          <button className="btn btn-secondary" onClick={handleTestMail} disabled={testMailLoading}>
            {testMailLoading ? 'Sending Test...' : 'Send Test Notification'}
          </button>
        </div>
      </div>

      {/* Tenant Details Modal */}
      {selectedTenant && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem'
        }}>
          <div className="card" style={{ maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Tenant Audit: {selectedTenant.tenant?.name}
              </h3>
              <button
                onClick={() => setSelectedTenant(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Email</span>
                <div style={{ fontWeight: 500 }}>{selectedTenant.tenant?.email}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Role & Status</span>
                <div>
                  <span className="badge badge-neutral" style={{ marginRight: '0.5rem' }}>{selectedTenant.tenant?.role}</span>
                  <span className={`badge ${selectedTenant.tenant?.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                    {selectedTenant.tenant?.status}
                  </span>
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Active Budgets</span>
                <div style={{ fontWeight: 500 }}>{selectedTenant.budgetCount} configured</div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avoided Cost</span>
                <div style={{ fontWeight: 600, color: 'var(--status-success)' }}>
                  ₹{selectedTenant.estimatedAvoidedCost?.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Azure Connections */}
            <div style={{ marginBottom: '1.25rem' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Linked Cloud Connections ({selectedTenant.connections?.length || 0})
              </h4>
              {selectedTenant.connections?.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No connections configured.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {selectedTenant.connections.map((c) => (
                    <div key={c.id} style={{ padding: '0.625rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: 600 }}>{c.connection_name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Subscription: {c.subscription_id}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Client ID: {c.client_id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Actions */}
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Recent Actions (Last 10)
              </h4>
              {selectedTenant.recentActions?.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No optimization actions recorded.</p>
              ) : (
                <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '0.35rem' }}>VM</th>
                        <th style={{ padding: '0.35rem' }}>Action</th>
                        <th style={{ padding: '0.35rem' }}>Status</th>
                        <th style={{ padding: '0.35rem' }}>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTenant.recentActions.map((a) => (
                        <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.35rem' }}>{a.vm_name}</td>
                          <td style={{ padding: '0.35rem' }}>{a.action}</td>
                          <td style={{ padding: '0.35rem' }}>{a.status}</td>
                          <td style={{ padding: '0.35rem', color: 'var(--text-muted)' }}>{new Date(a.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedTenant(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend / Activate Confirmation Modal */}
      {statusTarget && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem'
        }}>
          <div className="card" style={{ maxWidth: '480px', width: '100%' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Confirm Tenant {statusTarget.newStatus === 'SUSPENDED' ? 'Suspension' : 'Activation'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem', lineHeight: '1.5' }}>
              {statusTarget.newStatus === 'SUSPENDED' ? (
                <>
                  Are you sure you want to <strong>SUSPEND</strong> tenant <strong>{statusTarget.name}</strong>?
                  <br /><br />
                  <strong>Effects of Suspension:</strong>
                  <ul style={{ paddingLeft: '1.25rem', marginTop: '0.5rem', color: 'var(--status-error)' }}>
                    <li>All active refresh tokens are revoked immediately.</li>
                    <li>API access to Azure, AWS, and GCP operations is blocked.</li>
                    <li>Automated and manual optimization scans are disabled for this tenant.</li>
                  </ul>
                </>
              ) : (
                <>
                  Are you sure you want to <strong>ACTIVATE</strong> tenant <strong>{statusTarget.name}</strong>?
                  The user will be able to log in and resume cloud operations.
                </>
              )}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setStatusTarget(null)}
                disabled={actionInProgress}
              >
                Cancel
              </button>
              <button
                className={statusTarget.newStatus === 'SUSPENDED' ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={confirmStatusChange}
                disabled={actionInProgress}
              >
                {actionInProgress ? 'Processing...' : `Confirm ${statusTarget.newStatus === 'SUSPENDED' ? 'Suspend' : 'Activate'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
