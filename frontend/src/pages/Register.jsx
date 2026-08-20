import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserPlus, AlertCircle, CheckCircle2, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!name.trim() || !email.trim() || !password) {
      setError('All fields are required.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      // Backend expects strictly { name, email, password }
      await register(name.trim(), email.trim(), password);
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err) {
      if (!err.response) {
        setError('Unable to connect to CloudPulse server. Please check your network connection.');
      } else if (err.response.status === 429) {
        setError('Too many registration attempts. Please try again after 15 minutes.');
      } else {
        const errMsg = err.response.data?.error || err.response.data?.message || 'Registration failed. Please try again.';
        setError(errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
          Create Account
        </h2>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} />
          <span>Back to Home</span>
        </Link>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Register for CloudPulse Azure Optimization
      </p>

      {error && (
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
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{
          backgroundColor: 'var(--status-success-bg)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          color: 'var(--status-success)',
          fontSize: '0.875rem'
        }}>
          <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          <span>Account registered successfully! Redirecting to login...</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            required
            disabled={loading || success}
            autoComplete="name"
          />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
            disabled={loading || success}
            autoComplete="email"
          />
        </div>

        <div style={{ marginBottom: '1.25rem', position: 'relative' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
            Password (Min 8 characters)
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading || success}
              autoComplete="new-password"
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
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
                justifyContent: 'center',
                padding: '0.25rem'
              }}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
            Confirm Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading || success}
              autoComplete="new-password"
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
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
                justifyContent: 'center',
                padding: '0.25rem'
              }}
              title={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem' }} disabled={loading || success}>
          {loading ? (
            <div className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }}></div>
          ) : (
            <>
              <UserPlus size={18} />
              <span>Create Account</span>
            </>
          )}
        </button>
      </form>

      <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        Already have an account?{' '}
        <Link to="/login" style={{ fontWeight: '600' }}>
          Sign In
        </Link>
      </div>
    </div>
  );
};

export default Register;
