import { BrowserRouter as Router, Navigate, Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import PublicLayout from './layouts/PublicLayout'
import AdminLayout from './layouts/AdminLayout'
import BranchLayout from './layouts/BranchLayout'
import ProtectedRoute from './components/ProtectedRoute'
import UserProtectedRoute from './components/UserProtectedRoute'
import BranchProtectedRoute from './components/BranchProtectedRoute'
import SecurityProtectedRoute from './components/SecurityProtectedRoute'
import BranchPortalRedirect from './components/BranchPortalRedirect'
import GlobalSystemMessageModal from './components/GlobalSystemMessageModal'
import HomeEntry from './components/HomeEntry'
import UnifiedLogin from './pages/auth/UnifiedLogin'
import ForgotPassword from './pages/auth/ForgotPassword'
import UserRegister from './pages/user/UserRegister'
import VerifyCitizenEmail from './pages/user/VerifyCitizenEmail'
import InviteRegister from './pages/user/InviteRegister'
import UserDashboard from './pages/user/UserDashboard'
import BranchDashboard from './pages/branch/BranchDashboard'
import BranchQueueManagement from './pages/branch/QueueManagement'
import BranchReceiptManagement from './pages/branch/ReceiptManagement'
import BranchPaymentManagement from './pages/branch/PaymentManagement'
import BranchMemos from './pages/branch/BranchMemos'
import BranchAnnouncements from './pages/branch/BranchAnnouncements'
import BranchDiscrepancies from './pages/branch/BranchDiscrepancies'
import BranchPolicies from './pages/branch/BranchPolicies'
import BranchReports from './pages/branch/BranchReports'
import BranchSettings from './pages/branch/BranchSettings'
import LiveQueueMonitor from './pages/branch/LiveQueueMonitor'
import PayTaxes from './pages/public/PayTaxes'
import PayTaxesRPT from './pages/public/PayTaxesRPT'
import PayTaxesBT from './pages/public/PayTaxesBT'
import PayTaxesPlaceholder from './pages/public/PayTaxesPlaceholder'
import AccountManagement from './pages/public/AccountManagement'
import RequestReceipt from './pages/public/RequestReceipt'
import TaxpayerGuide from './pages/public/TaxpayerGuide'
import Contact from './pages/public/Contact'
import GetQueue from './pages/public/GetQueue'
import DataPrivacyAgreement from './pages/public/DataPrivacyAgreement'
import PaymentStatus from './pages/public/PaymentStatus'
import PaymentSuccess from './pages/public/PaymentSuccess'
import PaymentFailed from './pages/public/PaymentFailed'
import MobileReceiptUpload from './pages/public/MobileReceiptUpload'
import Dashboard from './pages/admin/Dashboard'
import Branches from './pages/admin/Branches'
import Reports from './pages/admin/Reports'
import Announcements from './pages/admin/Announcements'
import Memos from './pages/admin/Memos'
import Alerts from './pages/admin/Alerts'
import ActivityLogs from './pages/admin/ActivityLogs'
import SecurityBackupLogin from './pages/admin/SecurityBackupLogin'
import Policies from './pages/admin/Policies'
import Settings from './pages/admin/Settings'
import Accounts from './pages/admin/Accounts'
import QueueManagement from './pages/admin/QueueManagement'
import ReceiptManagement from './pages/admin/ReceiptManagement'
import PaymentManagement from './pages/admin/PaymentManagement'
import DiscrepancyReports from './pages/admin/DiscrepancyReports'
import TaxAssessment from './pages/admin/TaxAssessment'
import PublicContentManagement from './pages/shared/PublicContentManagement'

const BackupRecovery = lazy(() => import('./pages/admin/BackupRecovery'))

function App() {
  return (
    <Router>
      <GlobalSystemMessageModal />
      <Routes>
        {/* Public Portal */}
        <Route path="/" element={<PublicLayout />}>
          <Route index element={<HomeEntry />} />
          <Route path="pay-taxes" element={<UserProtectedRoute><PayTaxes /></UserProtectedRoute>} />
          <Route path="pay-taxes/rpt" element={<UserProtectedRoute><PayTaxesRPT /></UserProtectedRoute>} />
          <Route path="pay-taxes/bt/online" element={<UserProtectedRoute><PayTaxesBT /></UserProtectedRoute>} />
          <Route path="pay-taxes/:taxType" element={<UserProtectedRoute><PayTaxesPlaceholder /></UserProtectedRoute>} />
          <Route path="account-management" element={<UserProtectedRoute><AccountManagement /></UserProtectedRoute>} />
          <Route path="request-receipt" element={<UserProtectedRoute><RequestReceipt /></UserProtectedRoute>} />
          <Route path="taxpayer-guide" element={<TaxpayerGuide />} />
          <Route path="contact" element={<Contact />} />
          <Route path="get-queue" element={<UserProtectedRoute><GetQueue /></UserProtectedRoute>} />
          <Route path="data-privacy-agreement" element={<DataPrivacyAgreement />} />
        </Route>
        
        {/* Payment Result Pages */}
        <Route path="/payment/status" element={<PaymentStatus />} />
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/payment/failed" element={<PaymentFailed />} />
        <Route path="/mobile-receipt-upload/:token" element={<MobileReceiptUpload />} />
        
        <Route path="/login" element={<UnifiedLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/user/login" element={<UnifiedLogin preferredPortal="public" />} />
        <Route path="/user/register" element={<UserRegister />} />
        <Route path="/user/verify-email" element={<VerifyCitizenEmail />} />
        <Route path="/register/invite" element={<InviteRegister />} />
        <Route path="/portal" element={<UserProtectedRoute><UserDashboard /></UserProtectedRoute>} />
        <Route path="/user/dashboard" element={<UserProtectedRoute><UserDashboard /></UserProtectedRoute>} />
        
        {/* Branch Portal */}
        <Route path="/branch/login" element={<Navigate to="/login" replace />} />
        <Route path="/branch-dashboard" element={<BranchProtectedRoute><BranchPortalRedirect /></BranchProtectedRoute>} />
        <Route path="/branch-dashboard/:branchSlug" element={<BranchProtectedRoute><BranchLayout /></BranchProtectedRoute>}>
          <Route index element={<BranchDashboard />} />
          <Route path="queue" element={<BranchQueueManagement />} />
          <Route path="queue/live-monitor" element={<LiveQueueMonitor />} />
          <Route path="receipts" element={<BranchReceiptManagement />} />
          <Route path="payments" element={<BranchPaymentManagement />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="memos" element={<BranchMemos />} />
          <Route path="reports" element={<BranchReports />} />
          <Route path="announcements" element={<BranchAnnouncements />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="discrepancies" element={<BranchDiscrepancies />} />
          <Route path="policies" element={<BranchPolicies />} />
          <Route path="settings" element={<BranchSettings />} />
        </Route>
        {/* Dedicated Live Monitor Route - No Layout */}
        <Route path="/live-monitor/:branchSlug" element={<BranchProtectedRoute><LiveQueueMonitor /></BranchProtectedRoute>} />
        <Route path="/branch" element={<BranchProtectedRoute><BranchPortalRedirect /></BranchProtectedRoute>} />
        
        {/* Admin Portal */}
        <Route path="/admin/login" element={<Navigate to="/login" replace />} />
        <Route path="/admin/backup/login" element={<SecurityBackupLogin />} />
        <Route path="/admin/backup" element={<SecurityProtectedRoute><Suspense fallback={<div className="flex h-screen items-center justify-center text-slate-600">Loading Security Dashboard...</div>}><BackupRecovery /></Suspense></SecurityProtectedRoute>} />
        <Route path="/admin-dashboard" element={<ProtectedRoute><Navigate to="/admin" replace /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="branches" element={<Branches />} />
          <Route path="reports" element={<Reports />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="memos" element={<Memos />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="activity-logs" element={<ActivityLogs />} />
          <Route path="backup-recovery" element={<Navigate to="/admin/backup/login" replace />} />
          <Route path="policies" element={<Policies />} />
          <Route path="settings" element={<Settings />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="queue" element={<QueueManagement />} />
          <Route path="receipts" element={<ReceiptManagement />} />
          <Route path="payments" element={<PaymentManagement />} />
          <Route path="tax-assessment" element={<TaxAssessment />} />
          <Route path="public-content" element={<PublicContentManagement portal="admin" />} />
          <Route path="discrepancies" element={<DiscrepancyReports />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
