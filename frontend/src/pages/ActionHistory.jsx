import React, { useState, useEffect, useCallback } from 'react';
import { actionHistoryService } from '../services/actionHistoryService';
import { Link } from 'react-router-dom';
import {
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  Server,
  Sliders,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  Info,
  Play
} from 'lucide-react';

const ActionHistory = () => {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  // Filtering states
  const [searchVm, setSearchVm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Expanded row state for long reason strings
  const [expandedRows, setExpandedRows] = useState({});

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Fetch Action History
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let data;
      if (searchVm.trim()) {
        data = await actionHistoryService.getActionsByVm(searchVm.trim());
      } else {
        data = await actionHistoryService.getActions();
      }
      setActions(data.actions || []);
      setCurrentPage(1);
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to fetch action history.';
      setError(msg);
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [searchVm]);

  // Run Optimization Scan on demand
  const handleRunScan = async () => {
    setScanning(true);
    setError('');
    try {
      await actionHistoryService.runOptimizationNow();
      await fetchHistory();
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to run optimization scan.';
      setError(msg);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const toggleExpand = (id) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter actions locally by status dropdown
  const filteredActions = actions.filter((act) => {
    if (statusFilter === 'ALL') return true;
    const st = (act.status || '').toUpperCase();
    return st === statusFilter;
  });

  // Paginated records
  const totalPages = Math.ceil(filteredActions.length / pageSize) || 1;
  const paginatedActions = filteredActions.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Status Badge Renderer
  const renderStatusBadge = (act) => {
    const st = (act.status || '').toUpperCase();
    if (st === 'DRY_RUN') {
      return <span className="badge badge-info" title="Historical record.">HISTORICAL</span>;
    }
    if (st === 'SKIPPED') {
      return <span className="badge badge-warning" title="VM was already stopped/deallocated.">SKIPPED</span>;
    }
    if (st === 'BLOCKED') {
      return <span className="badge badge-error" title="Policy or safety rules prevented shutdown.">BLOCKED</span>;
    }
    if (st === 'SUCCESS') {
      return <span className="badge badge-success" title="VM deallocation completed successfully.">SUCCESS</span>;
    }
    if (st === 'FAILED') {
      return <span className="badge badge-error" title="Shutdown attempt failed.">FAILED</span>;
    }
    return <span className="badge badge-info">{st}</span>;
  };

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            Action History & Audit Log
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Review CloudPulse optimization decisions and VM actions for your Azure environment
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchHistory} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spinner' : ''} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          <span>Refresh History</span>
        </button>
      </div>



      {/* Error Banner */}
      {error && (
        <div style={{
          backgroundColor: 'var(--status-error-bg)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          color: 'var(--status-error)',
          fontSize: '0.875rem'
        }}>
          <AlertCircle size={18} style={{ inlineSize: '18px', display: 'inline', marginRight: '8px' }} />
          <span>{error}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Search VM Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '240px' }}>
            <Search size={18} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search history by VM Name..."
              value={searchVm}
              onChange={(e) => setSearchVm(e.target.value)}
              style={{ backgroundColor: 'var(--bg-primary)' }}
            />
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Filter size={16} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              style={{ backgroundColor: 'var(--bg-primary)', width: 'auto', minWidth: '160px' }}
            >
              <option value="ALL">All Statuses</option>

              <option value="SKIPPED">Skipped</option>
              <option value="BLOCKED">Blocked</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Action Audit Table */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <History size={22} style={{ color: 'var(--accent-primary)' }} />
            <span className="card-title">Tenant Audit Trail</span>
          </div>
          <span className="badge badge-info">{filteredActions.length} Total Records</span>
        </div>

        {loading ? (
          <div className="loading-center" style={{ padding: '3rem' }}>
            <div className="spinner"></div>
            <p style={{ fontSize: '0.875rem' }}>Loading action audit history...</p>
          </div>
        ) : filteredActions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', margin: '0 auto 1rem' }}>
              <History size={28} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
              No optimization actions yet
            </h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0 auto 1.5rem', fontSize: '0.875rem' }}>
              CloudPulse will record optimization evaluations, manual actions, and scheduled deallocations here.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <Link to="/vms" className="btn btn-secondary">
                <Server size={16} />
                <span>View Virtual Machines</span>
              </Link>
              <Link to="/optimization" className="btn btn-primary">
                <Sliders size={16} />
                <span>View Optimization Policy</span>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>VM Name</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>CPU Avg</th>
                    <th>Audit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedActions.map((act) => {
                    const rowId = act.id || `${act.timestamp}-${act.vmName}`;
                    const isExpanded = expandedRows[rowId];
                    const reasonText = act.reason || 'N/A';
                    const isLongReason = reasonText.length > 80;

                    return (
                      <tr key={rowId}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                          {new Date(act.timestamp || act.createdAt).toLocaleString()}
                        </td>
                        <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>
                          {act.vmName}
                        </td>
                        <td style={{ fontSize: '0.8125rem', fontWeight: '600' }}>
                          {act.action || 'DEALLOCATE'}
                        </td>
                        <td>{renderStatusBadge(act)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                          {act.cpuAverage != null ? `${Number(act.cpuAverage).toFixed(2)}%` : 'N/A'}
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', maxWidth: '360px' }}>
                          <div>
                            {isLongReason && !isExpanded ? `${reasonText.substring(0, 80)}...` : reasonText}
                          </div>
                          {isLongReason && (
                            <button
                              onClick={() => toggleExpand(rowId)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '2px', marginTop: '4px' }}
                            >
                              {isExpanded ? <>Show Less <ChevronUp size={12} /></> : <>Read Full Reason <ChevronDown size={12} /></>}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderTop: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  Page {currentPage} of {totalPages} ({filteredActions.length} records)
                </span>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                    onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                    onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ActionHistory;
