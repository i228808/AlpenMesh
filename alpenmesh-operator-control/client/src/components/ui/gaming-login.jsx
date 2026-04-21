import React, { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Mail, Lock, Chrome, Twitter, Gamepad2, User, Shield, X } from 'lucide-react';
import { Link } from 'react-router-dom';

// FormInput Component
const FormInput = ({
  id,
  label,
  icon,
  type,
  placeholder,
  value,
  onChange,
  required,
  autoComplete,
}) => {
  return (
    <div className="relative">
      {label ? (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      ) : null}
      <div className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</div>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete={autoComplete}
        aria-label={label || placeholder}
        className="w-full pl-10 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/60 focus:outline-none focus:border-sky-400/50 transition-colors"
      />
    </div>
  );
};

// SocialButton Component
const SocialButton = ({ icon, label }) => {
  return (
    <button
      type="button"
      className="flex items-center justify-center p-2 bg-white/5 border border-white/10 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors"
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
};

// ToggleSwitch Component
const ToggleSwitch = ({ checked, onChange, id }) => {
  return (
    <div className="relative inline-block w-10 h-5 cursor-pointer">
      <input type="checkbox" id={id} className="sr-only" checked={checked} onChange={onChange} />
      <div
        className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${checked ? 'bg-sky-500' : 'bg-white/20'}`}
      >
        <div
          className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${checked ? 'transform translate-x-5' : ''}`}
        />
      </div>
    </div>
  );
};

// VideoBackground Component
const VideoBackground = ({ videoUrl }) => {
  const videoRef = useRef(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduceMotion(!!mq?.matches);
    updateMotion();
    mq?.addEventListener?.('change', updateMotion);

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    setSaveData(!!conn?.saveData);

    return () => mq?.removeEventListener?.('change', updateMotion);
  }, []);

  useEffect(() => {
    if (reduceMotion || saveData) return;
    if (videoRef.current) {
      videoRef.current.play().catch((error) => {
        console.error('Video autoplay failed:', error);
      });
    }
  }, [reduceMotion, saveData]);

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden">
      {/* Gradient fallback background - Alpine mountain colors */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, #0c1929 0%, #1a365d 25%, #2d4a6f 50%, #1e3a5f 75%, #0f172a 100%)',
        }}
      />

      {/* Mountain silhouette overlay */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1/2 z-5"
        style={{
          background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 320'%3E%3Cpath fill='%23111827' fill-opacity='0.8' d='M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,202.7C672,203,768,181,864,165.3C960,149,1056,139,1152,154.7C1248,171,1344,213,1392,234.7L1440,256L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z'%3E%3C/path%3E%3C/svg%3E") no-repeat bottom`,
          backgroundSize: 'cover',
        }}
      />

      {/* Video layer */}
      {!reduceMotion && !saveData ? (
        <video
          ref={videoRef}
          className={`absolute inset-0 min-w-full min-h-full object-cover w-auto h-auto transition-opacity duration-1000 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
          autoPlay
          loop
          muted
          playsInline
          onLoadedData={() => setVideoLoaded(true)}
        >
          <source src={videoUrl} type="video/mp4" />
        </video>
      ) : null}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 z-10" />

      {/* Subtle animated gradient overlay */}
      <div
        className="absolute inset-0 z-10 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(56, 189, 248, 0.15) 0%, transparent 50%)',
        }}
      />
    </div>
  );
};

// Main LoginForm Component
const LoginForm = ({ onSubmit, errorMessage, onClearError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulated delay for effect
    await new Promise((resolve) => setTimeout(resolve, 800));

    try {
      await onSubmit(email, password, remember);
      setIsSuccess(true);
    } catch (error) {
      // Error handling is done in parent, but we stop submitting here
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8 rounded-2xl backdrop-blur-md bg-black/40 border border-white/10 shadow-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold mb-2 relative group">
          <span className="absolute -inset-1 bg-gradient-to-r from-sky-400/30 via-cyan-300/30 to-blue-500/30 blur-xl opacity-75 group-hover:opacity-100 transition-all duration-500 animate-pulse"></span>
          <span className="relative inline-block text-3xl font-bold mb-2 text-white tracking-widest uppercase">
            AlpenMesh
          </span>
        </h2>
        <p className="text-white/80 flex flex-col items-center space-y-1">
          <span className="relative group cursor-default">
            <span className="text-sm font-light tracking-wider">TRAFFIC CONTROL SYSTEM</span>
          </span>
        </p>
      </div>

      {errorMessage ? (
        <div
          className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 flex items-start justify-between gap-3"
          role="alert"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={onClearError}
            className="mt-0.5 text-rose-200/80 hover:text-rose-100"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <FormInput
          id="login-email"
          label="Email"
          icon={<Mail className="text-white/60" size={18} />}
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <div className="relative">
          <FormInput
            id="login-password"
            label="Password"
            icon={<Lock className="text-white/60" size={18} />}
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white focus:outline-none transition-colors"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div onClick={() => setRemember(!remember)} className="cursor-pointer">
              <ToggleSwitch
                checked={remember}
                onChange={() => setRemember(!remember)}
                id="remember-me"
              />
            </div>
            <label
              htmlFor="remember-me"
              className="text-sm text-white/80 cursor-pointer hover:text-white transition-colors"
            >
              Remember me
            </label>
          </div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="text-sm text-white/50 cursor-not-allowed"
            title="Password reset not implemented"
          >
            Forgot password (coming soon)
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3 rounded-lg ${
            isSuccess ? 'bg-green-600' : 'bg-sky-500 hover:bg-sky-600'
          } text-white font-bold tracking-wide transition-all duration-200 ease-in-out transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-50 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none shadow-lg shadow-sky-500/20 hover:shadow-sky-500/40`}
        >
          {isSubmitting ? 'AUTHENTICATING...' : 'ACCESS DASHBOARD'}
        </button>
      </form>

      <div className="mt-8">
        <div className="relative flex items-center justify-center">
          <div className="border-t border-white/10 absolute w-full"></div>
          <div className="bg-transparent px-4 relative text-white/60 text-xs uppercase tracking-widest">
            authorized personnel only
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-white/60">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="font-medium text-white hover:text-sky-300 transition-colors"
          >
            Create Account
          </Link>
        </p>
      </div>
    </div>
  );
};

// RegisterForm Component
const RegisterForm = ({ onSubmit, errorMessage, onClearError }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('basic');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      await onSubmit(username, email, password, role);
      setIsSuccess(true);
    } catch (error) {
      // Error handling
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8 rounded-2xl backdrop-blur-md bg-black/40 border border-white/10 shadow-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold mb-2 relative group">
          <span className="absolute -inset-1 bg-gradient-to-r from-sky-400/30 via-cyan-300/30 to-blue-500/30 blur-xl opacity-75 group-hover:opacity-100 transition-all duration-500 animate-pulse"></span>
          <span className="relative inline-block text-3xl font-bold mb-2 text-white tracking-widest uppercase">
            JOIN SYSTEM
          </span>
        </h2>
        <p className="text-white/80 flex flex-col items-center space-y-1">
          <span className="relative group cursor-default">
            <span className="text-sm font-light tracking-wider">CREATE NEW IDENTITY</span>
          </span>
        </p>
      </div>

      {errorMessage ? (
        <div
          className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 flex items-start justify-between gap-3"
          role="alert"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={onClearError}
            className="mt-0.5 text-rose-200/80 hover:text-rose-100"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <FormInput
          id="register-username"
          label="Username"
          icon={<User className="text-white/60" size={18} />}
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
        />

        <FormInput
          id="register-email"
          label="Email"
          icon={<Mail className="text-white/60" size={18} />}
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <div className="relative">
          <FormInput
            id="register-password"
            label="Password"
            icon={<Lock className="text-white/60" size={18} />}
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white focus:outline-none transition-colors"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <Shield className="text-white/60" size={18} />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/60 focus:outline-none focus:border-sky-400/50 transition-colors appearance-none"
          >
            <option value="basic" className="bg-gray-800 text-white">
              Basic User
            </option>
            <option value="admin" className="bg-gray-800 text-white">
              Administrator
            </option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3 rounded-lg ${
            isSuccess ? 'bg-green-600' : 'bg-sky-500 hover:bg-sky-600'
          } text-white font-bold tracking-wide transition-all duration-200 ease-in-out transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-50 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none shadow-lg shadow-sky-500/20 hover:shadow-sky-500/40`}
        >
          {isSubmitting ? 'REGISTERING...' : 'CREATE ACCOUNT'}
        </button>
      </form>

      <div className="mt-8">
        <div className="relative flex items-center justify-center">
          <div className="border-t border-white/10 absolute w-full"></div>
          <div className="bg-transparent px-4 relative text-white/60 text-xs uppercase tracking-widest">
            Switch Operation
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-white/60">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-white hover:text-sky-300 transition-colors">
            Login System
          </Link>
        </p>
      </div>
    </div>
  );
};

export { LoginForm, RegisterForm, VideoBackground };
