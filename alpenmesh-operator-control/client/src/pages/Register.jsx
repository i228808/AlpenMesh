import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { RegisterForm, VideoBackground } from '../components/ui/gaming-login';
import toast from 'react-hot-toast';

const Register = () => {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState(null);

  const handleRegister = async (username, email, password, role) => {
    try {
      setErrorMessage(null);
      await axios.post('http://localhost:3000/api/auth/register', {
        username,
        email,
        password,
        role,
      });
      // Navigate to login after successful registration
      navigate('/login');
    } catch (err) {
      console.error('Registration Error:', err);
      const msg = err.response?.data?.message || 'Registration failed';
      setErrorMessage(msg);
      toast.error(msg);
      throw err;
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center px-4 py-12 overflow-hidden">
      <VideoBackground videoUrl="https://cdn.pixabay.com/video/2021/02/23/66317-516453498_large.mp4" />

      <div className="relative z-20 w-full max-w-md animate-fadeIn">
        <RegisterForm
          onSubmit={handleRegister}
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

export default Register;
