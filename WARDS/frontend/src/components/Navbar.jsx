import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PublicBrandLogo from './PublicBrandLogo';
import ActionConfirmationModal from './ActionConfirmationModal';
import api from '../services/api';
import { clearSession } from '../utils/auth';
import { clearStoredPublicUser, getStoredPublicUser, PUBLIC_USER_STORAGE_EVENT } from '../utils/publicSession';
import { appendLanguageParam, usePublicLanguage } from '../utils/publicLanguage';

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

  const handleLanguageToggle = () => {
    const nextLanguage = language === 'en' ? 'tl' : 'en';
    setLanguage(nextLanguage);
    const nextPath = appendLanguageParam(`${location.pathname}${location.search}${location.hash}`, nextLanguage);
    navigate(nextPath, { replace: true });
  };

  const navigationLinks = [
    { to: '/', label: 'Home' },
    { to: '/get-queue', label: 'Get Queue Number' },
    { to: '/pay-taxes', label: 'Pay Taxes' },
    { to: '/request-receipt', label: 'Request Receipt' },
    { to: '/taxpayer-guide', label: 'Taxpayer Guide' },
    { to: '/contact', label: 'Contact Us' },
    { to: '/about-us', label: 'About Us' },
    { to: '/faqs', label: 'FAQs' },
  ];
  const drawerLinks = [
    navigationLinks[0],
    ...(isTaxpayerLoggedIn ? [{ to: '/account-management', label: 'Account Management' }] : []),
    ...navigationLinks.slice(1),
  ];

  return (
    <nav className="sticky top-0 z-50 bg-primary border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-[60px]">
          <PublicBrandLogo />

          <div className="flex items-center gap-2">
            {/* Language toggle — outlined pill */}
            <button
              onClick={handleLanguageToggle}
              className="rounded-full border border-white/20 bg-white/5 hover:bg-white/15 text-white px-4 py-1.5 text-xs font-semibold tracking-wide transition duration-200"
            >
              {language === 'en' ? 'Tagalog' : 'English'}
            </button>

            {/* Auth controls */}
            {isTaxpayerLoggedIn ? (
              <div className="flex items-center gap-2.5">
                <div className="hidden lg:block text-right max-w-[200px]">
                  <p className="text-[10px] text-blue-300/70 uppercase tracking-wider">Signed in as</p>
                  <p className="truncate text-sm font-semibold text-white leading-tight">
                    {displayPublicUser?.full_name || displayPublicUser?.email || 'Citizen User'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  disabled={isLoggingOut}
                  className="rounded-full bg-red-500/90 hover:bg-red-500 text-white px-5 py-1.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-70 shadow-sm"
                >
                  Logout
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                onClick={handleUnifiedSignIn}
                className="rounded-full bg-green-500 hover:bg-green-400 text-white px-5 py-1.5 text-sm font-semibold transition duration-200 shadow-sm"
              >
                Sign In
              </Link>
            )}

            {/* Hamburger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Toggle navigation menu"
                aria-expanded={menuOpen}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {menuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-3 w-[min(280px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#102b4d]/95 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.35)] backdrop-blur-xl">
                  <div className="mb-2 px-3 pb-2 border-b border-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/60">Navigation</p>
                  </div>
                  <div className="space-y-0.5 mt-2">
                    {drawerLinks.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                      >
                        <span>{link.label}</span>
                        <svg className="h-3.5 w-3.5 text-blue-200/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
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
