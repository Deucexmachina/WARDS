# PayMongo Integration - Quick Setup Guide

## 🚀 Quick Start (5 minutes)

### Step 1: Get PayMongo API Keys (2 minutes) sigma

1. Go to https://dashboard.paymongo.com/
2. Sign up or log in
3. Navigate to **Developers** → **API Keys**
4. Copy your keys:
   - **Secret Key** (starts with `sk_test_` for test mode)
   - **Public Key** (starts with `pk_test_` for test mode)

### Step 2: Configure Backend (1 minute)

1. Open `backend/.env` file
2. Add your PayMongo keys:

```env
PAYMONGO_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
PAYMONGO_PUBLIC_KEY=pk_test_YOUR_PUBLIC_KEY_HERE
```

3. Save the file

### Step 3: Run Database Migration (1 minute)

```bash
cd backend
python migrations/add_paymongo_fields.py
```

Type `yes` when prompted.

### Step 4: Restart Backend Server (1 minute)

```bash
# Stop the current server (Ctrl+C)
# Then restart:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Step 5: Test the Integration

1. Open frontend: http://localhost:5173
2. Log in as a public user
3. Go to **Pay Taxes Online**
4. Fill in the form:
   - Tax Type: Real Property Tax
   - Taxpayer Name: Test User
   - TIN: 123-456-789
   - Amount: 100.00
   - Branch: Select any branch
   - Payment Method: GCash
5. Click **Generate Payment Reference**
6. Click **Proceed to Payment**
7. You'll be redirected to PayMongo test checkout page
8. Complete the test payment
9. You'll be redirected back to success page

---

## ✅ Verification Checklist

After setup, verify these work:

- [ ] Payment reference generates successfully
- [ ] Proceed to Payment redirects to PayMongo
- [ ] Payment success page shows after payment
- [ ] Payment status shows "Verified" in database
- [ ] Branch personnel can see payment in dashboard
- [ ] Activity logs show payment events

---

## 🧪 Test Payment Methods

### GCash Test
- Use PayMongo's test GCash interface
- No real money involved

### Card Test
- Card Number: `4343434343434345`
- Expiry: Any future date (e.g., 12/28)
- CVV: Any 3 digits (e.g., 123)
- Name: Any name

---

## 🔧 Troubleshooting

### "PAYMONGO_SECRET_KEY not found"
**Fix**: Make sure you added the keys to `backend/.env` file

### Payment stuck in "Pending"
**Fix**: 
1. Check if webhook is configured (optional for testing)
2. Manually check status by visiting: 
   `http://localhost:8000/api/payments/paymongo/status/TXN-XXXXXX`

### Checkout URL not generated
**Fix**:
1. Verify API keys are correct
2. Check backend terminal for error messages
3. Ensure you're using test keys for test mode

---

## 📊 Monitoring Payments

### As Branch Personnel:
1. Log in to branch dashboard
2. Go to **Payments** section
3. View all payments with status
4. Filter by branch

### As Admin:
1. Log in to admin dashboard
2. Go to **Payments** section
3. View all payments across all branches
4. Monitor payment status in real-time

---

## 🔐 Security Notes

- ✅ Never commit `.env` file to git
- ✅ Use test keys for development
- ✅ Use live keys only in production
- ✅ Keep API keys secret

---

## 📞 Need Help?

1. Check `PAYMONGO_INTEGRATION_GUIDE.md` for detailed documentation
2. Review PayMongo docs: https://developers.paymongo.com/docs
3. Check backend logs: `backend/api.err.log`
4. Check activity logs in admin dashboard

---

## 🎯 What's Next?

After testing:

1. **For Production**:
   - Get live API keys from PayMongo
   - Replace test keys with live keys
   - Set up webhook URL (HTTPS required)
   - Test with real small amounts

2. **Optional Enhancements**:
   - Configure webhook for instant updates
   - Set up email notifications
   - Customize payment success page
   - Add payment receipt generation

---

## ✨ Features Now Available

- ✅ Real-time payment processing via PayMongo
- ✅ Support for GCash, Maya, Card, Online Banking
- ✅ Automatic payment verification
- ✅ Payment status monitoring for branch personnel
- ✅ Complete audit trail of all transactions
- ✅ Secure payment handling
- ✅ 24-hour payment reference expiry
- ✅ Error handling and user feedback

---

**Integration Complete! 🎉**

Your WARDS system now has fully functional PayMongo payment processing.
