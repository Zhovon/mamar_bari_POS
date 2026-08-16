import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/api/login`, { pin_code: pin });
      const { user, token } = response.data;
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      if (user.role === 'admin') navigate('/admin');
      else if (user.role === 'manager') navigate('/manager');
      else if (user.role === 'waiter') navigate('/mpos');
      else if (user.role === 'chef') navigate('/kds');
      else setError('Unknown role');

    } catch (err) {
      setError('Invalid PIN code');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-sm border border-gray-200">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Mamar Bari</h1>
          <p className="text-gray-500">POS & CRM System</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Enter PIN Code</label>
            <input 
              type="password" 
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-md p-4 text-center text-2xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              placeholder="••••"
              maxLength={6}
              autoFocus
            />
          </div>

          {error && <div className="text-red-500 text-sm text-center font-medium bg-red-50 py-2 rounded-md border border-red-100">{error}</div>}

          <button 
            type="submit" 
            className="w-full btn-primary py-4 text-lg"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
