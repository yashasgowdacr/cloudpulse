import React, { useState, useEffect, useCallback } from 'react';
import { optimizationPolicyService } from '../services/optimizationPolicyService';
import {
  Sliders,
  ShieldCheck,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Info,
  Power,
  Clock,
  Activity,
  AlertTriangle,
  X
} from 'lucide-react';

const OptimizationPolicy = () => {
  // Saved backend policy state
  const [savedPolicy, setSavedPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Editable Form State
  const [idleCpuThreshold, setIdleCpuThreshold] = useState(5.0);
  const [monitoringWindowMinutes, setMonitoringWindowMinutes] = useState(30);
  const [autoShutdown, setAutoShutdown] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Confirmation Modal State
  const [showEnableModal, setShowEnableModal] = useState(false);

  // Load Policy from Backend
  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await optimizationPolicyService.getOptimizationPolicy();
      const p = data.policy;
      setSavedPolicy(p);
      setIdleCpuThreshold(p.idleCpuThreshold ?? 5.0);
      setMonitoringWindowMinutes(p.monitoringWindowMinutes ?? 30);
      setAutoShutdown(Boolean(p.autoShutdown));
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to fetch optimization policy.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  // Check for unsaved changes
  const hasUnsavedChanges = savedPolicy && (
    Number(idleCpuThreshold) !== Number(savedPolicy.idleCpuThreshold) ||
    Number(monitoringWindowMinutes) !== Number(savedPolicy.monitoringWindowMinutes) ||
    Boolean(autoShutdown) !== Boolean(savedPolicy.autoShutdown)
  );

  // Form Save Execution
  const executeSave = async (autoShutdownVal = autoShutdown) => {
    setFormError('');
    setSuccessMsg('');

    const numThreshold = Number(idleCpuThreshold);
    const numWindow = Number(monitoringWindowMinutes);

    // Client-side Validation
    if (isNaN(numThreshold) || numThreshold < 0 || numThreshold > 100) {
      setFormError('Idle CPU Threshold must be a number between 0 and 100.');
      return;
    }

    if (!Number.isInteger(numWindow) || numWindow < 5 || numWindow > 1440) {
      setFormError('Monitoring Window must be an integer between 5 and 1440 minutes.');
      return;
    }

    setSaving(true);

    try {
      const result = await optimizationPolicyService.updateOptimizationPolicy({
        idleCpuThreshold: numThreshold,
        monitoringWindowMinutes: numWindow,
        autoShutdown: Boolean(autoShutdownVal)
      });

      const updated = result.policy;
      setSavedPolicy(updated);
      setIdleCpuThreshold(updated.idleCpuThreshold);
      setMonitoringWindowMinutes(updated.monitoringWindowMinutes);
      setAutoShutdown(updated.autoShutdown);

      setSuccessMsg('Optimization policy updated successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      setShowEnableModal(false);
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to update optimization policy.';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Submit Handler
  const handleSaveSubmit = (e) => {
    e.preventDefault();
    // If user is toggling autoShutdown from false to true, require confirmation modal first
    if (autoShutdown && !savedPolicy?.autoShutdown) {
      setShowEnableModal(true);
    } else {
      executeSave(autoShutdown);
    }
  };

  const handleConfirmEnableAutoShutdown = () => {
    executeSave(true);
  };

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            Optimization Policy
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Configure how CloudPulse identifies idle virtual machines and evaluates automatic shutdown
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchPolicy} disabled={loading || saving}>
          <RefreshCw size={16} className={loading ? 'spinner' : ''} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          <span>Refresh Policy</span>
        </button>
      </div>

      {/* Persistent Safe Mode Banner (DRY_RUN Active) */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid rgba(14, 165, 233, 0.4)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem 1.25rem',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.875rem'
      }}>
        <div style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>
          <ShieldCheck size={26} />
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--accent-primary)' }}>Safe Mode Active (DRY_RUN Enabled):</strong> CloudPulse is currently running with <code style={{ backgroundColor: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--accent-secondary)' }}>DRY_RUN=true</code>. All policy evaluations and deallocations are simulated for security, and zero real Azure VMs will be modified.
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
      {(error || formError) && (
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
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{error || formError}</span>
        </div>
      )}

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Policy Configuration Form */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Sliders size={22} style={{ color: 'var(--status-warning)' }} />
              <span className="card-title">Tenant Policy Configuration</span>
            </div>

            {hasUnsavedChanges ? (
              <span className="badge badge-warning">Unsaved Changes</span>
            ) : (
              <span className="badge badge-success">Saved</span>
            )}
          </div>

          {loading ? (
            <div className="loading-center" style={{ padding: '3rem' }}>
              <div className="spinner"></div>
              <p style={{ fontSize: '0.875rem' }}>Loading policy parameters...</p>
            </div>
          ) : (
            <form onSubmit={handleSaveSubmit}>
              {/* Idle CPU Threshold */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
                  <Activity size={16} style={{ color: 'var(--accent-primary)' }} />
                  <span>Idle CPU Threshold (%)</span>
                </label>
                <input
                  type="number"
                  value={idleCpuThreshold}
                  onChange={(e) => setIdleCpuThreshold(e.target.value)}
                  step="0.5"
                  min="0"
                  max="100"
                  required
                  disabled={saving}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem', display: 'block' }}>
                  A VM is classified as idle when its average CPU utilization falls below this percentage during the monitoring window. (Allowed: 0 - 100%).
                </span>
              </div>

              {/* Monitoring Window */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
                  <Clock size={16} style={{ color: 'var(--accent-secondary)' }} />
                  <span>Monitoring Window (Minutes)</span>
                </label>
                <input
                  type="number"
                  value={monitoringWindowMinutes}
                  onChange={(e) => setMonitoringWindowMinutes(e.target.value)}
                  step="5"
                  min="5"
                  max="1440"
                  required
                  disabled={saving}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem', display: 'block' }}>
                  Timespan over which average CPU utilization is evaluated via Azure Monitor metrics. (Allowed: 5 to 1440 minutes).
                </span>
              </div>

              {/* Auto-Shutdown Toggle */}
              <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <Power size={16} style={{ color: autoShutdown ? 'var(--status-success)' : 'var(--status-warning)' }} />
                    <span>Automatic VM Shutdown</span>
                  </label>

                  <input
                    type="checkbox"
                    checked={autoShutdown}
                    onChange={(e) => setAutoShutdown(e.target.checked)}
                    disabled={saving}
                    style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                  />
                </div>

                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {autoShutdown ? (
                    <span style={{ color: 'var(--status-warning)', fontWeight: '600' }}>
                      Enabled: CloudPulse will evaluate idle VMs against your policy for automatic deallocation.
                    </span>
                  ) : (
                    <span>
                      Disabled (Safe Default): CloudPulse will identify and evaluate idle VMs for reporting, but will <strong>not</strong> automatically deallocate them.
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={fetchPolicy}
                  disabled={saving || !hasUnsavedChanges}
                >
                  Discard Changes
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !hasUnsavedChanges}
                >
                  {saving ? (
                    <>
                      <div className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }}></div>
                      <span>Saving Policy...</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Save Policy</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* How Your Policy Works Walkthrough Card */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Info size={22} style={{ color: 'var(--accent-primary)' }} />
              <span className="card-title">How Your Policy Works</span>
            </div>
            <span className="badge badge-info">Authoritative Backend Policy</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                1
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Continuous CPU Monitoring:</strong> CloudPulse queries Azure Monitor metrics for your virtual machines over the configured {monitoringWindowMinutes}-minute window.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                2
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Idle Evaluation:</strong> A VM is flagged as idle if average CPU utilization remains below {idleCpuThreshold}%.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                3
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Policy Engine Enforcement:</strong> The backend policy engine evaluates safety rules, environment guards, and auto-shutdown flags before any action.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                4
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Dry-Run Guard:</strong> In development mode (<code style={{ color: 'var(--accent-secondary)' }}>DRY_RUN=true</code>), deallocations are logged to audit history without touching Azure resources.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-Shutdown Enable Confirmation Modal */}
      {showEnableModal && (
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
            maxWidth: '520px',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--status-warning)', marginBottom: '1rem' }}>
              <AlertTriangle size={28} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                You are enabling automatic VM shutdown
              </h2>
            </div>

            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              <p style={{ marginBottom: '0.75rem' }}>
                Please confirm that you want to enable automatic shutdown for your account:
              </p>
              <ul style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <li>CloudPulse will evaluate VMs against your threshold ({idleCpuThreshold}% CPU over {monitoringWindowMinutes}m).</li>
                <li>Eligible idle VMs will be evaluated by the backend policy engine.</li>
                <li>Safety guards and production protection remain enforced by backend rules.</li>
                <li><strong style={{ color: 'var(--accent-primary)' }}>DRY_RUN mode currently prevents real Azure deallocations.</strong></li>
              </ul>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => { setShowEnableModal(false); setAutoShutdown(false); }}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                className="btn btn-primary"
                onClick={handleConfirmEnableAutoShutdown}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <div className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }}></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Power size={16} />
                    <span>Enable Auto-Shutdown & Save</span>
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

export default OptimizationPolicy;
