import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { settingsService } from '../services/settingsService';
import {
  User,
  Lock,
  Bell,
  Shield,
  Tag,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Save,
  RefreshCw
} from 'lucide-react';

const Settings = () => {
  const { user, login } = useAuth();
  const [activeTab, setActiveTab] = useState('account');

  // Account / Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Notifications state
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError, setNotifError] = useState('');
  const [notifSuccess, setNotifSuccess] = useState('');
  const [deallocationNotifs, setDeallocationNotifs] = useState(true);
  const [optimizationNotifs, setOptimizationNotifs] = useState(true);

  // Exclusion tags state
  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState('');
  const [tagsSuccess, setTagsSuccess] = useState('');
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState(null);

  // Fetch Notification Preferences
  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    setNotifError('');
    try {
      const data = await settingsService.getNotificationPreferences();
      if (data.preferences) {
        setDeallocationNotifs(Boolean(data.preferences.deallocationNotifications));
        setOptimizationNotifs(Boolean(data.preferences.optimizationNotifications));
      }
    } catch (err) {
      setNotifError(err.response?.data?.message || 'Failed to load notification preferences.');
    } finally {
      setNotifLoading(false);
    }
  }, []);

  // Fetch Exclusion Tags
  const fetchTags = useCallback(async () => {
    setTagsLoading(true);
    setTagsError('');
    try {
      const data = await settingsService.getExclusionTags();
      setTags(data.tags || []);
    } catch (err) {
      setTagsError(err.response?.data?.message || 'Failed to load exclusion tags.');
    } finally {
      setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'notifications') {
      fetchNotifications();
    } else if (activeTab === 'safety') {
      fetchTags();
    }
  }, [activeTab, fetchNotifications, fetchTags]);

  // Handle Password Change
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Current password is required.');
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await settingsService.updatePassword({
        currentPassword,
        newPassword
      });
      setPasswordSuccess(res.message || 'Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (res.accessToken && res.user && login) {
        login(res.accessToken, res.user);
      }
    } catch (err) {
      setPasswordError(err.response?.data?.message || 'Failed to change password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  // Handle Notifications Save
  const handleSaveNotifications = async (e) => {
    e.preventDefault();
    setNotifSaving(true);
    setNotifError('');
    setNotifSuccess('');
    try {
      await settingsService.updateNotificationPreferences({
        deallocationNotifications: deallocationNotifs,
        optimizationNotifications: optimizationNotifs
      });
      setNotifSuccess('Notification preferences updated successfully.');
      setTimeout(() => setNotifSuccess(''), 4000);
    } catch (err) {
      setNotifError(err.response?.data?.message || 'Failed to update notification preferences.');
    } finally {
      setNotifSaving(false);
    }
  };

  // Handle Add Exclusion Tag
  const handleAddTag = async (e) => {
    e.preventDefault();
    setTagsError('');
    setTagsSuccess('');

    if (!newTagKey.trim()) {
      setTagsError('Tag key is required.');
      return;
    }
    if (!newTagValue.trim()) {
      setTagsError('Tag value is required.');
      return;
    }

    setAddingTag(true);
    try {
      await settingsService.addExclusionTag({
        tagKey: newTagKey.trim(),
        tagValue: newTagValue.trim()
      });
      setTagsSuccess(`Exclusion tag '${newTagKey.trim()}=${newTagValue.trim()}' added.`);
      setNewTagKey('');
      setNewTagValue('');
      await fetchTags();
      setTimeout(() => setTagsSuccess(''), 4000);
    } catch (err) {
      setTagsError(err.response?.data?.message || 'Failed to add exclusion tag.');
    } finally {
      setAddingTag(false);
    }
  };

  // Handle Delete Exclusion Tag
  const handleDeleteTag = async (tagId) => {
    setTagsError('');
    setTagsSuccess('');
    setDeletingTagId(tagId);
    try {
      await settingsService.deleteExclusionTag(tagId);
      setTagsSuccess('Exclusion tag deleted.');
      await fetchTags();
      setTimeout(() => setTagsSuccess(''), 4000);
    } catch (err) {
      setTagsError(err.response?.data?.message || 'Failed to delete exclusion tag.');
    } finally {
      setDeletingTagId(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
          Settings & Policies
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Manage your account credentials, alert preferences, and VM safety rules
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${activeTab === 'account' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('account')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <User size={18} />
          Account & Security
        </button>

        <button
          className={`btn ${activeTab === 'notifications' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('notifications')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Bell size={18} />
          Notification Alerts
        </button>

        <button
          className={`btn ${activeTab === 'safety' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('safety')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Shield size={18} />
          Safety & Exclusions
        </button>
      </div>

      {/* TAB 1: ACCOUNT & SECURITY */}
      {activeTab === 'account' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
          {/* User Profile Card */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <User size={22} style={{ color: 'var(--accent-primary)' }} />
                <span className="card-title">User Profile</span>
              </div>
              <span className={`badge ${user?.role === 'ADMIN' ? 'badge-warning' : 'badge-info'}`}>
                {user?.role || 'USER'}
              </span>
            </div>

            <div style={{ display: 'grid', gap: '1.25rem', marginTop: '0.5rem' }}>
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

          {/* Change Password Card */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Lock size={22} style={{ color: 'var(--accent-primary)' }} />
                <span className="card-title">Change Password</span>
              </div>
            </div>

            {passwordError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-danger)', borderRadius: '6px', color: 'var(--status-danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                <AlertCircle size={18} />
                <span>{passwordError}</span>
              </div>
            )}

            {passwordSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--status-success)', borderRadius: '6px', color: 'var(--status-success)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                <CheckCircle2 size={18} />
                <span>{passwordSuccess}</span>
              </div>
            )}

            <form onSubmit={handlePasswordChange}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Current Password
                </label>
                <input
                  type="password"
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  New Password (min. 8 characters)
                </label>
                <input
                  type="password"
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={passwordLoading}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {passwordLoading ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                {passwordLoading ? 'Updating Password...' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: NOTIFICATIONS */}
      {activeTab === 'notifications' && (
        <div className="card" style={{ maxWidth: '680px' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Bell size={22} style={{ color: 'var(--accent-primary)' }} />
              <span className="card-title">Email Notification Alerts</span>
            </div>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            CloudPulse delivers alerts via Google OAuth2 directly to your registered account email ({user?.email}).
          </p>

          {notifError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-danger)', borderRadius: '6px', color: 'var(--status-danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>
              <AlertCircle size={18} />
              <span>{notifError}</span>
            </div>
          )}

          {notifSuccess && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--status-success)', borderRadius: '6px', color: 'var(--status-success)', marginBottom: '1rem', fontSize: '0.875rem' }}>
              <CheckCircle2 size={18} />
              <span>{notifSuccess}</span>
            </div>
          )}

          {notifLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
              <RefreshCw className="animate-spin" size={24} style={{ color: 'var(--accent-primary)' }} />
            </div>
          ) : (
            <form onSubmit={handleSaveNotifications}>
              <div style={{ display: 'grid', gap: '1.25rem', marginBottom: '1.5rem' }}>
                {/* Deallocation Notifications */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <input
                    type="checkbox"
                    id="deallocNotif"
                    checked={deallocationNotifs}
                    onChange={(e) => setDeallocationNotifs(e.target.checked)}
                    style={{ marginTop: '0.25rem', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <label htmlFor="deallocNotif" style={{ fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                      VM Deallocation & Shutdown Alerts
                    </label>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                      Receive immediate notification when an idle virtual machine is deallocated or if an Azure deallocation encounters an error.
                    </p>
                  </div>
                </div>

                {/* Optimization Scan Notifications */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <input
                    type="checkbox"
                    id="optNotif"
                    checked={optimizationNotifs}
                    onChange={(e) => setOptimizationNotifs(e.target.checked)}
                    style={{ marginTop: '0.25rem', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <label htmlFor="optNotif" style={{ fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                      Optimization Summary Alerts
                    </label>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                      Receive notifications on scheduled automation scans and periodic cost optimization summaries.
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={notifSaving}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {notifSaving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                {notifSaving ? 'Saving Preferences...' : 'Save Notification Preferences'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* TAB 3: SAFETY & EXCLUSIONS */}
      {activeTab === 'safety' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
          {/* Active Exclusion Tags List */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Shield size={22} style={{ color: 'var(--status-success)' }} />
                <span className="card-title">Custom Exclusion Tags</span>
              </div>
              <button
                className="btn btn-secondary"
                onClick={fetchTags}
                disabled={tagsLoading}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                <RefreshCw size={14} className={tagsLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Mandatory Safety Notice */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem', backgroundColor: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '6px', marginBottom: '1.25rem' }}>
              <Shield size={20} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Mandatory Safeguards:</strong> VMs with names containing "prod" or "production", or Azure tags <code>Environment=production</code> or <code>AutoShutdown=disabled</code> are permanently protected and cannot be overridden.
              </div>
            </div>

            {tagsSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--status-success)', borderRadius: '6px', color: 'var(--status-success)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                <CheckCircle2 size={18} />
                <span>{tagsSuccess}</span>
              </div>
            )}

            {tagsError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-danger)', borderRadius: '6px', color: 'var(--status-danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                <AlertCircle size={18} />
                <span>{tagsError}</span>
              </div>
            )}

            {tagsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                <RefreshCw className="animate-spin" size={24} style={{ color: 'var(--accent-primary)' }} />
              </div>
            ) : tags.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No custom exclusion tags defined. Add key/value pairs to protect additional workloads.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {tags.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.65rem 0.85rem',
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Tag size={16} style={{ color: 'var(--accent-primary)' }} />
                      <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                        {t.tagKey}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>=</span>
                      <span className="badge badge-info" style={{ fontSize: '0.8rem' }}>
                        {t.tagValue}
                      </span>
                    </div>

                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteTag(t.id)}
                      disabled={deletingTagId === t.id}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      title="Delete Exclusion Tag"
                    >
                      <Trash2 size={14} />
                      {deletingTagId === t.id ? 'Deleting...' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Exclusion Tag Form */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Plus size={22} style={{ color: 'var(--accent-primary)' }} />
                <span className="card-title">Add Exclusion Rule</span>
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              Virtual machines matching this tag will be protected from automatic deallocation.
            </p>

            <form onSubmit={handleAddTag}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Tag Key (e.g. CostCenter, Workload, Tier)
                </label>
                <input
                  type="text"
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={newTagKey}
                  onChange={(e) => setNewTagKey(e.target.value)}
                  placeholder="e.g. CostCenter"
                  required
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Tag Value (e.g. Critical, Protected, Database)
                </label>
                <input
                  type="text"
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  placeholder="e.g. Critical"
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={addingTag}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {addingTag ? <RefreshCw className="animate-spin" size={16} /> : <Plus size={16} />}
                {addingTag ? 'Adding Rule...' : 'Add Exclusion Tag'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
