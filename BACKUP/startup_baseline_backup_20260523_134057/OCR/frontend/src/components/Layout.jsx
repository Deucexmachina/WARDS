import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

function Layout({ children }) {
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [taxpayerUser, setTaxpayerUser] = useState(null)

  const navItems = [
    { path: '/', label: 'Home' },
    { path: '/about', label: 'About Us' },
    { path: '/services', label: 'Services' },
    { path: '/rpt-payment', label: 'Pay Taxes Online' },
    { path: '/queue', label: 'Queue System' },
    { path: '/contact', label: 'Contact Us' },
  ]

  useEffect(() => {
    const stored = localStorage.getItem('taxpayerUser')
    setTaxpayerUser(stored ? JSON.parse(stored) : null)
  }, [location.pathname])

  const handleTaxpayerLogout = () => {
    localStorage.removeItem('taxpayerToken')
    localStorage.removeItem('taxpayerUser')
    setTaxpayerUser(null)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-primary-700 text-white shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Link to="/" className="w-12 h-12 bg-white rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors cursor-pointer">
                <img src="/src/assets/logo.png" alt="WARDS Logo" className="w-8 h-8" />
              </Link>
              <div>
                <h1 className="text-xl md:text-2xl font-bold">City Treasurer's Office - Galas Branch</h1>
                <p className="text-xs md:text-sm text-primary-100">Queue Management System</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {taxpayerUser ? (
                <div className="hidden md:flex items-center gap-3 rounded-full bg-primary-600 px-4 py-2">
                  <div className="text-right">
                    <p className="text-xs text-primary-100">Signed in as</p>
                    <p className="text-sm font-semibold">{taxpayerUser.full_name}</p>
                  </div>
                  <button
                    onClick={handleTaxpayerLogout}
                    className="rounded-full bg-red-500 px-3 py-1 text-sm font-semibold text-white hover:bg-red-400"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <Link
                  to="/taxpayer-login"
                  className="hidden md:inline-flex rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-500"
                >
                  Taxpayer Portal
                </Link>
              )}
              {/* Login Icon Button */}
              <Link
                to="/login"
                className="text-white hover:bg-primary-600 p-2 rounded-full transition-colors duration-200"
                title="Admin Login"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </Link>
              {/* Hamburger Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden text-white focus:outline-none focus:ring-2 focus:ring-white rounded p-2"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        {/* Desktop Navigation */}
        <nav className="hidden md:block bg-primary-800">
          <div className="container mx-auto px-4">
            <ul className="flex flex-wrap space-x-1">
              {navItems.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`block px-4 py-3 transition-colors duration-200 ${
                      location.pathname === item.path
                        ? 'bg-primary-900 text-white'
                        : 'text-primary-100 hover:bg-primary-700'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <nav className="md:hidden bg-primary-800">
            <div className="container mx-auto px-4 py-2">
              <ul className="space-y-1">
                {navItems.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`block px-4 py-3 rounded transition-colors duration-200 ${
                        location.pathname === item.path
                          ? 'bg-primary-900 text-white'
                          : 'text-primary-100 hover:bg-primary-700'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-grow container mx-auto px-4 py-8">
        {children}
      </main>

      <footer className="bg-gray-800 text-white mt-auto">
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="font-bold text-lg mb-2">City Treasurer's Office - Galas Branch</h3>
              <p className="text-gray-400 text-sm">
                Ano lalagay natin dito
              </p>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-2">Quick Links</h3>
              <ul className="text-gray-400 text-sm space-y-1">
                <li><Link to="/" className="hover:text-white">Home</Link></li>
                <li><Link to="/services" className="hover:text-white">Services</Link></li>
                <li><Link to="/rpt-payment" className="hover:text-white">RPT Online Payment</Link></li>
                <li><Link to="/queue" className="hover:text-white">Queue System</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-2">Contact</h3>
              <p className="text-gray-400 text-sm">
                Email: ctogalasbranch@gmail.com<br />
                Phone: 7005-0881
              </p>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-6 pt-4 text-center text-gray-400 text-sm">
            <p>&copy; 2026 City Treasurer's Office - Galas Branch. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Layout
