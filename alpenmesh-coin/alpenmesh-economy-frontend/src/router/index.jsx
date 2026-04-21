import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'

import { PublicLayout } from '@/components/layout/PublicLayout'
import { AppLayout } from '@/components/layout/AppLayout'

// Public pages
import Landing from '@/pages/public/Landing'
import Features from '@/pages/public/Features'
import HowItWorks from '@/pages/public/HowItWorks'
import MarketingMarketplace from '@/pages/public/Marketplace'
import About from '@/pages/public/About'

// Auth pages
import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'

// App pages
import Dashboard from '@/pages/app/Dashboard'
import Workers from '@/pages/app/Workers'
import WorkerDetail from '@/pages/app/WorkerDetail'
import Wallets from '@/pages/app/Wallets'
import Proofs from '@/pages/app/Proofs'
import Profile from '@/pages/app/Profile'
import Jobs from '@/pages/app/Jobs'
import AppMarketplace from '@/pages/app/AppMarketplace'
import ApiDocs from '@/pages/app/ApiDocs'

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeIn' } },
}

function PageTransition({ children }) {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ willChange: 'opacity, transform' }}>
      {children}
    </motion.div>
  )
}

/** Scrolls to the top of the page on every route change. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function RequireAuth() {
  const { isAuthed } = useAuth()
  if (!isAuthed) return <Navigate to="/login" replace />
  return <Outlet />
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <>
      <ScrollToTop />
      <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Public */}
        <Route path="/" element={<PublicLayout><PageTransition><Landing /></PageTransition></PublicLayout>} />
        <Route path="/features" element={<PublicLayout><PageTransition><Features /></PageTransition></PublicLayout>} />
        <Route path="/how-it-works" element={<PublicLayout><PageTransition><HowItWorks /></PageTransition></PublicLayout>} />
        <Route path="/marketplace" element={<PublicLayout><PageTransition><MarketingMarketplace /></PageTransition></PublicLayout>} />
        <Route path="/about" element={<PublicLayout><PageTransition><About /></PageTransition></PublicLayout>} />

        {/* Auth */}
        <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
        <Route path="/signup" element={<PageTransition><Signup /></PageTransition>} />

        {/* App (protected) */}
        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppLayout><Outlet /></AppLayout>}>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<PageTransition><Dashboard /></PageTransition>} />
            <Route path="workers" element={<PageTransition><Workers /></PageTransition>} />
            <Route path="workers/:id" element={<PageTransition><WorkerDetail /></PageTransition>} />
            <Route path="wallets" element={<PageTransition><Wallets /></PageTransition>} />
            <Route path="proofs" element={<PageTransition><Proofs /></PageTransition>} />
            <Route path="jobs" element={<PageTransition><Jobs /></PageTransition>} />
            <Route path="marketplace" element={<PageTransition><AppMarketplace /></PageTransition>} />
            <Route path="api-docs" element={<PageTransition><ApiDocs /></PageTransition>} />
            <Route path="profile" element={<PageTransition><Profile /></PageTransition>} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
    </>
  )
}

export default AnimatedRoutes
