import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';

import Login from './views/Login';
import MPOS from './views/MPOS';
import KDS from './views/KDS';
import Manager from './views/Manager';
import Admin from './views/Admin';
import TableOrder from './views/TableOrder';

// Axios Interceptor for JWT
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/order" element={<TableOrder />} />
        <Route path="/mpos" element={<MPOS />} />
        <Route path="/kds" element={<KDS />} />
        <Route path="/manager" element={<Manager />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
