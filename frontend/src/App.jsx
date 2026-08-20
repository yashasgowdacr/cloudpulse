import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthLayout from './layouts/AuthLayout';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';

import Dashboard from './pages/Dashboard';
import AzureConnections from './pages/AzureConnections';
import VirtualMachines from './pages/VirtualMachines';
import CostOverview from './pages/CostOverview';
import CostSavings from './pages/CostSavings';
import OptimizationPolicy from './pages/OptimizationPolicy';
import ActionHistory from './pages/ActionHistory';
import Settings from './pages/Settings';

import AdminPanel from './pages/AdminPanel';
import Forbidden from './pages/Forbidden';
import NotFound from './pages/NotFound';

function App() {
  return (
    <Routes>
      {/* Public Landing */}
      <Route path="/" element={<Home />} />

      {/* Public Auth Routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Authenticated SaaS Routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/azure" element={<AzureConnections />} />
          <Route path="/vms" element={<VirtualMachines />} />
          <Route path="/costs" element={<CostOverview />} />
          <Route path="/savings" element={<CostSavings />} />
          <Route path="/optimization" element={<OptimizationPolicy />} />
          <Route path="/actions" element={<ActionHistory />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/403" element={<Forbidden />} />

          {/* Admin Protected Route */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPanel />} />
          </Route>
        </Route>
      </Route>

      {/* 404 Fallback */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
