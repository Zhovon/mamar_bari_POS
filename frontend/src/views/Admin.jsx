import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Admin() {
  const [command, setCommand] = useState('');
  const [logs, setLogs] = useState([{ type: 'system', text: 'Welcome to Mamar Bari Secure Admin Terminal v1.0.0' }]);
  const bottomRef = useRef(null);
  const navigate = useNavigate();

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const executeCommand = async (e) => {
    e.preventDefault();
    if (!command.trim()) return;

    setLogs(prev => [...prev, { type: 'input', text: `$ ${command}` }]);
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(`${API_URL}/api/admin/terminal`, 
        { command }, 
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setLogs(prev => [...prev, { type: 'output', text: response.data.output || 'Command executed successfully. (No output)' }]);
    } catch (error) {
      // The terminal ships disabled -- say so plainly rather than looking broken.
      const text = error.response?.data?.code === 'TERMINAL_DISABLED'
        ? 'The web terminal is switched off on the server.\nTo enable it temporarily, set ENABLE_ADMIN_TERMINAL=true and restart the backend.\nLeave it off in normal operation: it runs any command on the server, guarded only by a 4-digit PIN.'
        : (error.response?.data?.error || error.message);
      setLogs(prev => [...prev, { type: 'error', text }]);
    }
    setCommand('');
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col p-6 font-sans">
      
      <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Developer Command Center</h1>
          <p className="text-sm text-gray-500 font-medium">System Inspection & Direct Database Access</p>
        </div>
        <button onClick={handleLogout} className="bg-white border border-gray-300 text-gray-700 font-medium px-4 py-2 rounded-md hover:bg-gray-50 transition-colors shadow-sm">Logout</button>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* Terminal Section */}
        <div className="flex-1 flex flex-col bg-gray-900 rounded-lg shadow-md border border-gray-800 overflow-hidden">
          <div className="bg-gray-800 px-4 py-3 border-b border-gray-700 flex justify-between items-center">
            <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Live Web Terminal</h2>
            <div className="flex space-x-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">
            {logs.map((log, idx) => (
              <div key={idx} className={`whitespace-pre-wrap ${
                log.type === 'system' ? 'text-blue-400 font-bold' :
                log.type === 'error' ? 'text-red-400' :
                log.type === 'input' ? 'text-green-400 font-bold' :
                'text-gray-300'
              }`}>
                {log.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={executeCommand} className="border-t border-gray-700 bg-gray-800 p-3 flex">
            <span className="text-green-400 font-bold mr-2 mt-1">$</span>
            <input 
              type="text" 
              value={command}
              onChange={e => setCommand(e.target.value)}
              className="flex-1 bg-transparent text-gray-100 font-mono outline-none"
              placeholder="Enter bash command (e.g., ls -la, ping google.com)"
              autoFocus
            />
          </form>
        </div>


      </div>
    </div>
  );
}
