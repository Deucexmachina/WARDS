import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import Layout from './components/Layout'

// Public pages
import Home from './pages/Home'
import About from './pages/About'
import Services from './pages/Services'
import Queue from './pages/Queue'
import Contact from './pages/Contact'
import Login from './pages/Login'
import TaxpayerSignup from './pages/TaxpayerSignup'
import TaxpayerLogin from './pages/TaxpayerLogin'
import QueueDisplay from './pages/QueueDisplay'
import RPTOnlinePayment from './pages/RPTOnlinePayment'

// Admin pages
import AdminHome from './pages/AdminHome'
import AdminDashboard from './pages/AdminDashboard'
import ReceiptRecords from './pages/ReceiptRecords'
import ReceiptEdit from './pages/ReceiptEdit'
import AuditLogs from './pages/AuditLogs'
import AccountManagement from './pages/AccountManagement'
import RPTValidationQueue from './pages/RPTValidationQueue'

function App() {
  return (
    <Router>
      <Routes>

        {/* Public display */}
        <Route path="/display" element={<QueueDisplay />} />

        {/* Admin routes */}
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/queue" element={<AdminDashboard />} />
        <Route path="/admin/accounts" element={<AccountManagement />} />
        <Route path="/admin/rpt-payments" element={<RPTValidationQueue />} />
        <Route path="/admin/receipts" element={<ReceiptRecords />} />
        <Route path="/admin/receipts/add" element={<ReceiptRecords />} />
        <Route path="/admin/receipts/edit" element={<ReceiptEdit />} />
        <Route path="/admin/audit" element={<AuditLogs />} />

        {/* Public site */}
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about" element={<About />} />
                <Route path="/services" element={<Services />} />
                <Route path="/queue" element={<Queue />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/login" element={<Login />} />
                <Route path="/taxpayer-signup" element={<TaxpayerSignup />} />
                <Route path="/taxpayer-login" element={<TaxpayerLogin />} />
                <Route path="/rpt-payment" element={<RPTOnlinePayment />} />
              </Routes>
            </Layout>
          }
        />

      </Routes>
    </Router>
  )
}

export default App
