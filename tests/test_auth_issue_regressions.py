import logging
import subprocess
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from routes import branches, memos, unified_auth
from utils.log_sanitization import SanitizeUvicornReloadPathFilter


class ListQuery:
    def __init__(self, rows):
        self.rows = list(rows)

    def all(self):
        return self.rows


class BranchLookupDB:
    def __init__(self, branches_):
        self.branches = list(branches_)

    def query(self, model):
        if model is memos.Branch:
            return ListQuery(self.branches)
        return ListQuery([])


def test_uvicorn_reload_log_filter_sanitizes_absolute_watch_paths():
    record = logging.LogRecord(
        name="uvicorn.error",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Will watch for changes in these directories: ['C:\\Users\\dwayn\\repo\\WARDS\\backend']",
        args=(),
        exc_info=None,
    )

    assert SanitizeUvicornReloadPathFilter().filter(record) is True
    assert record.getMessage() == "Will watch for changes"
    assert "C:\\Users" not in record.getMessage()


def test_auth_datetime_helpers_compare_aware_utc_values_correctly():
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    past = datetime.now(timezone.utc) - timedelta(minutes=5)

    assert unified_auth.is_expired_at(future) is False
    assert unified_auth.is_expired_at(past) is True
    assert unified_auth.seconds_since(past) >= 0


def test_memo_branch_lookup_returns_decrypted_branch_names():
    branch = branches.Branch(
        id=10,
        name="Galas Branch",
        location="Quezon City",
        contact="123",
        dashboard_url="http://localhost:3000/branch-dashboard/galas-branch",
        status="Active",
    )
    branches.apply_branch_security_fields(branch)

    lookup = memos.build_branch_lookup(BranchLookupDB([branch]))

    assert lookup[10] == "Galas Branch"
    assert not lookup[10].startswith("BRANCH_NAME")


def test_frontend_auth_utilities_support_superadmin_branch_workflow():
    script = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isSafeUrl, safeNavigate } from './WARDS/frontend/src/utils/urlValidator.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

let authCode = fs.readFileSync('./WARDS/frontend/src/utils/auth.js', 'utf8');
authCode = authCode
  .replace("import { clearStoredPublicUser, setStoredPublicUser } from './publicSession';", "const clearStoredPublicUser = () => {}; const setStoredPublicUser = (user) => localStorage.setItem('publicUser', JSON.stringify(user));")
  .replaceAll('export const ', 'const ');
authCode += '\nglobalThis.__auth = { getStoredPortal, persistSession };';
vm.runInThisContext(authCode, { filename: 'auth.js' });
const { getStoredPortal, persistSession } = globalThis.__auth;

persistSession({
  portal: 'admin',
  access_token: 'admin-token',
  user: { role: 'admin', internal_role: 'superadmin' },
});
persistSession({
  portal: 'branch',
  access_token: 'branch-token',
  user: { role: 'branch', internal_role: 'branch_admin', superadmin_managed_branch: true },
  preserveAdminSession: true,
});

// Tokens are no longer stored in localStorage (HttpOnly cookies instead)
assert.equal(localStorage.getItem('wardsPortal'), 'branch');
assert.equal(localStorage.getItem('adminToken'), null);
assert.equal(localStorage.getItem('branchToken'), null);
assert.equal(isSafeUrl('/branch-dashboard/galas-branch'), true);
assert.equal(isSafeUrl('//evil.example/branch-dashboard'), false);
assert.equal(isSafeUrl('javascript:alert(1)'), false);

let assignedTo = '';
const windowObj = {
  location: {
    assign: (value) => { assignedTo = value; },
  },
};
assert.equal(safeNavigate('/branch-dashboard/galas-branch', windowObj), true);
assert.equal(assignedTo, '/branch-dashboard/galas-branch');

localStorage.removeItem('branchUser');
localStorage.removeItem('branchAuthenticatedAt');
assert.equal(getStoredPortal(), 'branch');

// Clearing branch portal should fall back to admin via legacy detection
localStorage.removeItem('wardsPortal');
assert.equal(getStoredPortal(), null);
"""
    result = subprocess.run(
        ["node", "--experimental-specifier-resolution=node", "--input-type=module", "-e", script],
        cwd=".",
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_frontend_auth_uses_cookie_aware_client_for_deployed_login_flows():
    watched_files = [
        "WARDS/frontend/src/pages/auth/UnifiedLogin.jsx",
        "WARDS/frontend/src/pages/admin/SecurityBackupLogin.jsx",
        "WARDS/frontend/src/pages/admin/SystemSettingsLogin.jsx",
        "WARDS/frontend/src/pages/branch/BranchSystemSettingsLogin.jsx",
    ]

    for path in watched_files:
        source = open(path, encoding="utf-8").read()
        assert "axios.post(`${API_HOST}/api/auth/unified/" not in source
        assert "import axios from 'axios';" not in source

    api_source = open("WARDS/frontend/src/services/api.js", encoding="utf-8").read()
    assert "localStorage.getItem('adminToken')" not in api_source
    assert "localStorage.getItem('branchToken')" not in api_source
    assert "localStorage.getItem('userToken')" not in api_source
    assert "config.headers.Authorization = `Bearer ${token}`;" not in api_source
