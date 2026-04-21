import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthContext from '../context/AuthContext';
import axios from 'axios';
import { LoginForm, VideoBackground } from '../components/ui/gaming-login';
import toast from 'react-hot-toast';

const Login = () => {
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState(null);

  const handleLogin = async (email, password, remember) => {
    try {
      setErrorMessage(null);
      const res = await axios.post('http://localhost:3000/api/auth/login', { email, password });
      const { token, ...userData } = res.data;
      login(token, res.data);
      navigate('/dashboard');
    } catch (err) {
      console.error('Login Error:', err);
      const msg = err.response?.data?.message || 'Login failed';
      setErrorMessage(msg);
      toast.error(msg);
      throw err;
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center px-4 py-12 overflow-hidden">
      <VideoBackground videoUrl="https://cdn.pixabay.com/video/2021/02/23/66317-516453498_large.mp4" />

      <div className="relative z-20 w-full max-w-md animate-fadeIn">
        <LoginForm
          onSubmit={handleLogin}
          errorMessage={errorMessage}
          onClearError={() => setErrorMessage(null)}
        />
      </div>

      <footer className="absolute bottom-4 left-0 right-0 text-center text-white/40 text-xs z-20 uppercase tracking-widest">
        © 2025 AlpenMesh Systems. All rights reserved.
      </footer>
    </div>
  );
};

export default Login;
