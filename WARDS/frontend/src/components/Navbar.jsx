import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PublicBrandLogo from './PublicBrandLogo';
import ActionConfirmationModal from './ActionConfirmationModal';
import api from '../services/api';
import { clearSession } from '../utils/auth';
import { clearStoredPublicUser, getStoredPublicUser, PUBLIC_USER_STORAGE_EVENT } from '../utils/publicSession';
import { usePublicLanguage } from '../utils/publicLanguage';

const hasPublicSession = () =>
  Boolean(
    localStorage.getItem('userToken') ||
    localStorage.getItem('publicToken') ||
    localStorage.getItem('user') ||
    localStorage.getItem('publicUser')
  );

const Navbar = () => {
  const [language, setLanguage] = usePublicLanguage();
  const [publicUser, setPublicUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const displayPublicUser = publicUser || getStoredPublicUser();

  useEffect(() => {
    const syncPublicUser = () => {
      try {
        setPublicUser(getStoredPublicUser());
      } catch {
        setPublicUser(null);
      }
    };

    syncPublicUser();
    window.addEventListener('storage', syncPublicUser);
    window.addEventListener('focus', syncPublicUser);
    window.addEventListener(PUBLIC_USER_STORAGE_EVENT, syncPublicUser);
    return () => {
      window.removeEventListener('storage', syncPublicUser);
      window.removeEventListener('focus', syncPublicUser);
      window.removeEventListener(PUBLIC_USER_STORAGE_EVENT, syncPublicUser);
    };
  }, [location.pathname]);

  const isTaxpayerLoggedIn = Boolean(displayPublicUser || hasPublicSession());

  const finalizeLogout = () => {
    localStorage.removeItem('loginPortal');
    sessionStorage.removeItem('loginPortal');
    clearSession('public');
    localStorage.removeItem('publicToken');
    clearStoredPublicUser();
    sessionStorage.removeItem('redirectAfterLogin');
    sessionStorage.removeItem('loginMessage');
    setPublicUser(null);
    setMenuOpen(false);
    setShowLogoutConfirm(false);
    navigate('/', { replace: true });
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    try {
      setIsLoggingOut(true);
      await api.post('/public/auth/logout');
    } catch (error) {
      console.error('Public logout failed:', error);
    } finally {
      setIsLoggingOut(false);
      finalizeLogout();
    }
  };

  const handleUnifiedSignIn = () => {
    sessionStorage.removeItem('loginPortal');
    sessionStorage.removeItem('loginMessage');
    setMenuOpen(false);
  };

  const navigationLinks = [
    { to: '/', label: 'Home' },
    { to: '/pay-taxes', label: 'Pay Taxes' },
    { to: '/request-receipt', label: 'Request Receipt' },
    { to: '/taxpayer-guide', label: 'Taxpayer Guide' },
    { to: '/contact', label: 'Contact' },
  ];
  const drawerLinks = [
    ...navigationLinks.slice(0, 2),
    ...(isTaxpayerLoggedIn ? [{ to: '/account-management', label: 'Account Management' }] : []),
    ...navigationLinks.slice(2),
  ];

  return (
    <nav className="bg-primary shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <PublicBrandLogo />
          
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setLanguage((current) => (current === 'en' ? 'tl' : 'en'))}
              className="bg-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition duration-300 text-sm font-medium"
            >
              {language === 'en' ? 'English' : 'Tagalog'}
            </button>
            {isTaxpayerLoggedIn ? (
              <div className="flex items-center space-x-3">
                <div className="hidden lg:block text-right max-w-[220px]">
                  <p className="text-xs text-blue-200">Signed in as user:</p>
                  <p className="truncate text-sm font-semibold text-white">
                    {displayPublicUser?.full_name || displayPublicUser?.email || 'Citizen User'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  disabled={isLoggingOut}
                  className="bg-red-500 hover:bg-red-600 text-white px-5 py-2 rounded-lg transition duration-300 font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Logout
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                onClick={handleUnifiedSignIn}
                className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-lg transition duration-300 font-semibold"
              >
                Sign In
              </Link>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Toggle navigation menu"
                aria-expanded={menuOpen}
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {menuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-3 w-[280px] rounded-2xl border border-white/10 bg-[#102b4d]/95 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.35)] backdrop-blur-xl">
                  <div className="mb-2 px-3 pb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-200/80">Navigation</p>
                  </div>
                  <div className="space-y-1">
                    {drawerLinks.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                      >
                        <span>{link.label}</span>
                        <svg className="h-4 w-4 text-blue-200/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ActionConfirmationModal
        open={showLogoutConfirm}
        title="Are you sure you want to logout?"
        message="Your current citizen session will be ended and you will return to the public portal home page."
        confirmLabel="Confirm Logout"
        loadingLabel="Logging out..."
        isLoading={isLoggingOut}
        onCancel={() => {
          if (!isLoggingOut) {
            setShowLogoutConfirm(false);
          }
        }}
        onConfirm={handleLogout}
      />
    </nav>
  );
};

export default Navbar;
