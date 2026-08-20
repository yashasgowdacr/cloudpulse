import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminRoute = ({ children }) => {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="loading-center" style={{ height: '100vh' }}>
        <div className="spinner"></div>
        <p>Verifying administrative privileges...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/403" replace />;
  }

  return children ? children : <Outlet />;
};

export default AdminRoute;
