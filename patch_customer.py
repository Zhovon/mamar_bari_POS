import sys

def main():
    with open('frontend/src/views/TableOrder.jsx', 'r') as f:
        content = f.read()

    # Import useToast
    if "useToast" not in content:
        content = content.replace("import { io } from 'socket.io-client';", "import { io } from 'socket.io-client';\nimport { useToast } from '../context/ToastContext';")
    
    # Initialize useToast
    if "const toast = useToast();" not in content:
        content = content.replace("  const [billRequested, setBillRequested] = useState(false);", "  const [billRequested, setBillRequested] = useState(false);\n  const toast = useToast();")
        
    # Update socket listeners
    socket_anchor = """    socket.on('session_updated', refreshState);
    socket.on('bill_paid', () => {
      setState((prev) => (prev ? { ...prev, settled: true } : prev));
      setPhase((prev) => (prev === 'closed' ? prev : 'review'));
    });"""
    
    new_socket_logic = """    socket.on('session_updated', (data) => {
      refreshState();
      if (data?.reason === 'order_confirmed') {
        toast.success("Your order was confirmed by staff!");
      } else if (data?.reason === 'order_rejected') {
        toast.error("Your order was rejected by staff.");
      }
    });
    socket.on('bill_paid', () => {
      toast.success("Your bill was marked as paid! Thank you!");
      setState((prev) => (prev ? { ...prev, settled: true } : prev));
      setPhase((prev) => (prev === 'closed' ? prev : 'review'));
    });"""
    
    content = content.replace(socket_anchor, new_socket_logic)

    with open('frontend/src/views/TableOrder.jsx', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    main()
