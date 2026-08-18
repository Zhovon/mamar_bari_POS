import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';

export default function KDS() {
  const [orders, setOrders] = useState([]);
  const navigate = useNavigate();
  const toast = useToast();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    fetchQueue();

    const socket = io(API_URL);
    socket.on('new_order', (data) => {
      fetchQueue();
      toast.info(`New order received for Table ${data?.tableId || '...'}`);
    });
    socket.on('order_status_updated', () => {
      fetchQueue();
    });

    return () => socket.disconnect();
  }, []);

  const fetchQueue = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/kitchen/queue`);
      setOrders(response.data);
    } catch (error) {
      console.error('Error fetching kitchen queue:', error);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`${API_URL}/api/orders/${orderId}/status`, { status: newStatus });
      fetchQueue();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  // Helper to determine ticket color based on time waiting
  const getTicketColor = (createdAt, status) => {
    if (status === 'Ready') return 'border-t-4 border-t-green-500 bg-white';
    
    const minutesWaiting = (new Date() - new Date(createdAt)) / 60000;
    if (minutesWaiting > 15) return 'border-t-4 border-t-red-500 bg-red-50'; // Red alert
    if (minutesWaiting > 10) return 'border-t-4 border-t-yellow-400 bg-yellow-50'; // Yellow warning
    return 'border-t-4 border-t-blue-500 bg-white'; // Normal
  };

  const getHeaderColor = (createdAt, status) => {
    if (status === 'Ready') return 'bg-green-100 text-green-800 border-b border-green-200';
    
    const minutesWaiting = (new Date() - new Date(createdAt)) / 60000;
    if (minutesWaiting > 15) return 'bg-red-100 text-red-800 border-b border-red-200'; 
    if (minutesWaiting > 10) return 'bg-yellow-100 text-yellow-800 border-b border-yellow-200'; 
    return 'bg-blue-50 text-blue-800 border-b border-blue-100'; 
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col">
      <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Kitchen Display System (KDS)</h1>
        <div className="text-gray-500 font-medium">Live Orders: <span className="text-gray-900 font-bold text-xl">{orders.length}</span></div>
        <button onClick={handleLogout} className="bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium px-4 py-2 rounded-md transition-colors border border-gray-300 shadow-sm">Logout</button>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-6 pb-4" style={{ width: 'max-content' }}>
          {orders.map(order => {
            const ticketColor = getTicketColor(order.created_at, order.order_status);
            const headerColor = getHeaderColor(order.created_at, order.order_status);
            const minutesWaiting = Math.floor((new Date() - new Date(order.created_at)) / 60000);

            return (
              <div key={order.order_id} className={`w-80 rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden shrink-0 ${ticketColor}`}>
                
                {/* Header */}
                <div className={`${headerColor} p-4 flex justify-between items-center`}>
                  <div className="font-bold text-xl">Table {order.table_number}</div>
                  <div className="text-sm font-semibold">{minutesWaiting} min ago</div>
                </div>

                {/* Items */}
                <div className="p-4 flex-1 overflow-y-auto space-y-3 bg-white">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-start border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                      <div>
                        <div className="text-base text-gray-900 font-bold">{item.quantity}x {item.name}</div>
                        {item.notes && <div className="text-sm text-red-600 font-medium mt-1 uppercase italic">Note: {item.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-gray-100 bg-gray-50">
                  {order.order_status === 'Pending' && (
                    <button 
                      onClick={() => updateOrderStatus(order.order_id, 'Cooking')}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-md transition-colors shadow-sm"
                    >
                      Start Cooking
                    </button>
                  )}
                  {order.order_status === 'Cooking' && (
                    <button 
                      onClick={() => updateOrderStatus(order.order_id, 'Ready')}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-md transition-colors shadow-sm"
                    >
                      Mark as Ready
                    </button>
                  )}
                  {order.order_status === 'Ready' && (
                    <div className="w-full bg-gray-200 text-gray-500 font-bold py-3 rounded-md text-center">
                      Waiting for Waiter...
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
