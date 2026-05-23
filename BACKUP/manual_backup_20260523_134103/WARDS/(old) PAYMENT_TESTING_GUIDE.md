# Payment Testing Guide - WARDS PayMongo Integration

## Overview
This guide provides comprehensive instructions for testing all payment flows in the WARDS system using PayMongo's test environment.

---

## Test Environment Setup

### Prerequisites
1. **Backend Server Running**: `uvicorn main:app --reload` in `WARDS/backend`
2. **Frontend Server Running**: `npm run dev` in `WARDS/frontend`
3. **PayMongo Test Keys**: Configured in `.env` file
4. **Test Mode**: PayMongo automatically uses test mode with test keys

---

## Available Payment Methods

### 1. **GCash** (E-Wallet)
- **Payment Type**: `gcash`
- **Test Flow**: Redirects to PayMongo test checkout
- **Supported Actions**: Success, Failure, Expiry

### 2. **Maya** (E-Wallet)
- **Payment Type**: `maya` (mapped to `paymaya` in PayMongo)
- **Test Flow**: Redirects to PayMongo test checkout
- **Supported Actions**: Success, Failure, Expiry

### 3. **Card** (Credit/Debit Card)
- **Payment Type**: `card`
- **Test Flow**: Redirects to PayMongo test checkout
- **Supported Actions**: Success, Failure, Expiry
- **Test Cards**: PayMongo provides test card numbers

### 4. **Online Banking**
- **Payment Type**: `banking` (mapped to `card` in PayMongo)
- **Bank Selection**: BDO, BPI, Metrobank, UnionBank, Landbank, PNB, RCBC, Security Bank, China Bank
- **Test Flow**: Uses card payment method in test mode
- **Note**: Bank selection is for UI/UX purposes; actual processing uses PayMongo checkout

---

## Tax Types Testing

### Available Tax Types
1. **Real Property Tax**
2. **Business Tax**
3. **Miscellaneous Tax**

### Testing Each Tax Type

#### Test Case: Real Property Tax
```
Tax Type: Real Property Tax
Taxpayer Name: Juan Dela Cruz
TIN: 123-456-789-000
Property Reference: RPT-2024-001
Email: juan.delacruz@test.com
Amount: 5000.00
Branch: Main Branch
Payment Method: GCash
```

#### Test Case: Business Tax
```
Tax Type: Business Tax
Taxpayer Name: ABC Corporation
TIN: 987-654-321-000
Business Reference: BUS-2024-100
Email: accounting@abc.com
Amount: 15000.00
Branch: Main Branch
Payment Method: Maya
```

#### Test Case: Miscellaneous Tax
```
Tax Type: Miscellaneous Tax
Taxpayer Name: Maria Santos
TIN: 555-666-777-000
Reference: MISC-2024-050
Email: maria.santos@test.com
Amount: 2500.00
Branch: Main Branch
Payment Method: Card
```

---

## Payment Flow Testing

### Flow 1: Successful Payment

1. **Navigate to Payment Page**: `/pay-taxes`
2. **Fill Required Fields**:
   - Select Tax Type
   - Enter Taxpayer Name
   - Enter TIN
   - Enter Amount (minimum 0.01)
   - Select Branch
   - Select Payment Method
   - (If Online Banking) Select Bank
3. **Generate Reference**: Click "Generate Payment Reference"
4. **Verify Reference Display**:
   - Reference Number shown
   - Transaction ID shown
   - Amount displayed correctly
   - Status shows "Pending"
5. **Proceed to Payment**: Click "Proceed to Payment"
6. **PayMongo Checkout**:
   - Redirected to PayMongo test checkout
   - Select "Complete Test Payment" option
7. **Success Page**: Redirected to `/payment/success?ref=TXN-XXXXXX`
8. **Verify Success Display**:
   - Green checkmark icon
   - "Payment Successful!" message
   - All payment details shown
   - Status badge shows "Verified"
   - Print Receipt button available
   - Make Another Payment button available

### Flow 2: Failed Payment

1. **Follow Steps 1-5** from Flow 1
2. **PayMongo Checkout**:
   - Redirected to PayMongo test checkout
   - Select "Expire/Fail Test Payment" option
3. **Failed Page**: Redirected to `/payment/failed?ref=TXN-XXXXXX`
4. **Verify Failed Display**:
   - Red X icon
   - "Payment Failed" message
   - Payment details shown
   - Status badge shows "Failed"
   - Failure reason displayed
   - Tips for next steps shown
   - "Start New Payment" button available

### Flow 3: Expired Payment

1. **Follow Steps 1-5** from Flow 1
2. **PayMongo Checkout**:
   - Redirected to PayMongo test checkout
   - Wait for session to expire (or close tab without completing)
3. **Check Status**: Navigate back to success URL manually
4. **Verify Expired Display**:
   - Orange warning icon
   - "Payment Expired" message
   - Status badge shows "Expired"
   - Expiry message displayed

### Flow 4: Cancelled Payment

1. **Follow Steps 1-5** from Flow 1
2. **PayMongo Checkout**:
   - Redirected to PayMongo test checkout
   - Click "Cancel" or close the checkout window
3. **Return to Site**: Use browser back button or cancel URL
4. **Verify Handling**: System should show appropriate cancelled/failed state

---

## Field Validation Testing

### Required Fields Validation

Test that the following validations work:

1. **Tax Type**: Must be selected
   - Error: "Please select a tax type"

2. **Taxpayer Name**: Cannot be empty
   - Error: "Taxpayer name is required"

3. **TIN**: Cannot be empty
   - Error: "TIN is required"

4. **Amount**: Must be greater than 0
   - Error: "Please enter a valid amount"

5. **Branch**: Must be selected
   - Error: "Please select a branch"

6. **Email** (Optional): Must be valid format if provided
   - Error: "Please enter a valid email address"

7. **Bank** (When Online Banking selected): Must be selected
   - Error: "Please select a bank"

### Test Invalid Inputs

```
Test Case: Empty Form Submission
- Leave all fields empty
- Click "Generate Payment Reference"
- Expected: All required field errors shown
- Error message: "Please correct the errors in the form before proceeding."
```

```
Test Case: Invalid Email
- Fill all required fields
- Enter invalid email: "notanemail"
- Click "Generate Payment Reference"
- Expected: Email validation error shown
```

```
Test Case: Zero Amount
- Fill all required fields
- Enter amount: 0
- Click "Generate Payment Reference"
- Expected: Amount validation error shown
```

```
Test Case: Online Banking Without Bank Selection
- Fill all required fields
- Select "Online Banking" payment method
- Don't select a bank
- Click "Generate Payment Reference"
- Expected: Bank selection error shown
```

---

## Payment Method Testing

### Test Each Payment Method

#### GCash Testing
```
1. Select GCash as payment method
2. Complete payment flow
3. Verify GCash icon displayed
4. Verify payment method recorded as "gcash"
```

#### Maya Testing
```
1. Select Maya as payment method
2. Complete payment flow
3. Verify Maya icon displayed
4. Verify payment method recorded as "maya"
```

#### Card Testing
```
1. Select Card as payment method
2. Complete payment flow
3. Verify Card icon displayed
4. Verify payment method recorded as "card"
```

#### Online Banking Testing
```
1. Select Online Banking as payment method
2. Verify bank selection dropdown appears
3. Select each bank option:
   - BDO
   - BPI
   - Metrobank
   - UnionBank
   - Landbank
   - PNB
   - RCBC
   - Security Bank
   - China Bank
4. Verify bank information message displays
5. Complete payment flow
6. Verify payment method recorded as "banking"
```

---

## Status Polling Testing

### Automatic Status Updates

1. **Complete Payment**: Finish a test payment
2. **Observe Polling**: Success/Failed page polls status every 3 seconds
3. **Verify Updates**: Status updates automatically without refresh
4. **Check Redirect**: Failed payments redirect to failed page
5. **Verify Stop**: Polling stops when final status reached

---

## Backend Verification

### Database Checks

After each payment test, verify in the database:

1. **Payment Record Created**:
   - `ref_number` matches displayed reference
   - `txn_id` generated correctly
   - `taxpayer_name` stored correctly
   - `tax_type` matches selection
   - `amount` stored correctly
   - `payment_method` matches selection
   - `branch` matches selection
   - `status` updated correctly

2. **Activity Logs Created**:
   - "Payment Reference Generated" log exists
   - "PayMongo Checkout Session Created" log exists
   - "Payment Verified" log exists (for successful payments)
   - "Payment Failed" log exists (for failed payments)

3. **PayMongo IDs Stored**:
   - `paymongo_checkout_session_id` populated
   - `paymongo_payment_intent_id` populated
   - `paymongo_status` matches PayMongo response

### API Endpoint Testing

Test these endpoints directly:

```bash
# Generate Reference
POST http://localhost:8000/api/payments/generate-reference
Body: {
  "taxType": "Real Property Tax",
  "taxpayerName": "Test User",
  "tin": "123-456-789",
  "amount": 1000,
  "branch": "Main Branch",
  "paymentMethod": "gcash"
}

# Process Payment
POST http://localhost:8000/api/payments/process
Body: {
  "refNumber": "TXN-123456",
  "paymentMethod": "gcash"
}

# Check Status
GET http://localhost:8000/api/payments/paymongo/status/TXN-123456

# Get All Payments
GET http://localhost:8000/api/payments/
```

---

## UI/UX Testing

### Visual Consistency Checks

1. **Color Scheme**:
   - Primary: #0B2545 (dark blue)
   - Secondary: #13315C
   - Accent: #1E4D8F (blue)
   - Light Background: #F4F7FB

2. **Typography**:
   - Font: Inter
   - Headings: Bold, appropriate sizes
   - Body text: Regular weight, readable

3. **Spacing**:
   - Consistent padding/margins
   - Proper gap between elements
   - Responsive on mobile/tablet/desktop

4. **Interactive Elements**:
   - Hover states work
   - Focus states visible
   - Disabled states clear
   - Loading states shown

### Responsive Testing

Test on different screen sizes:
- **Mobile**: 375px width
- **Tablet**: 768px width
- **Desktop**: 1920px width

Verify:
- Forms stack properly on mobile
- Payment method buttons responsive
- Payment details readable
- Buttons full-width on mobile

---

## Error Handling Testing

### Network Errors

1. **Disconnect Network**: Turn off internet
2. **Try Payment**: Attempt to generate reference
3. **Verify Error**: Appropriate error message shown
4. **Reconnect**: Turn on internet
5. **Retry**: Payment should work

### Backend Errors

1. **Stop Backend**: Stop the backend server
2. **Try Payment**: Attempt to generate reference
3. **Verify Error**: Connection error shown
4. **Restart Backend**: Start server again
5. **Retry**: Payment should work

### Invalid Reference

1. **Manual URL**: Navigate to `/payment/success?ref=INVALID`
2. **Verify Error**: "Payment not found" error shown
3. **Return Button**: Works correctly

---

## Performance Testing

### Load Testing

1. **Multiple Payments**: Create 10+ payments rapidly
2. **Verify Performance**: All complete successfully
3. **Check Database**: All records created
4. **Check Logs**: All activity logged

### Concurrent Users

1. **Multiple Tabs**: Open payment page in multiple tabs
2. **Simultaneous Payments**: Create payments at same time
3. **Verify Isolation**: Each payment independent
4. **Check References**: All unique reference numbers

---

## Test Checklist

### Pre-Testing
- [ ] Backend server running
- [ ] Frontend server running
- [ ] PayMongo test keys configured
- [ ] Database accessible
- [ ] Branches loaded in system

### Tax Types
- [ ] Real Property Tax payment works
- [ ] Business Tax payment works
- [ ] Miscellaneous Tax payment works

### Payment Methods
- [ ] GCash payment works
- [ ] Maya payment works
- [ ] Card payment works
- [ ] Online Banking payment works
- [ ] All bank options selectable

### Payment Flows
- [ ] Successful payment flow complete
- [ ] Failed payment flow complete
- [ ] Expired payment flow complete
- [ ] Cancelled payment flow complete

### Validation
- [ ] All required fields validated
- [ ] Email format validated
- [ ] Amount validation works
- [ ] Bank selection validated (for banking)

### UI/UX
- [ ] Forms look professional
- [ ] Colors consistent with WARDS
- [ ] Icons display correctly
- [ ] Responsive on all devices
- [ ] Loading states shown
- [ ] Error messages clear

### Backend
- [ ] Payment records created
- [ ] Activity logs created
- [ ] PayMongo IDs stored
- [ ] Status updates correctly

### Error Handling
- [ ] Network errors handled
- [ ] Backend errors handled
- [ ] Invalid data handled
- [ ] User feedback clear

---

## Common Issues & Solutions

### Issue: Payment stuck in "Processing"
**Solution**: Check PayMongo webhook configuration and status polling

### Issue: Reference not generating
**Solution**: Verify all required fields filled, check backend logs

### Issue: Redirect not working
**Solution**: Check FRONTEND_BASE_URL in backend .env file

### Issue: Bank selection not showing
**Solution**: Ensure "Online Banking" payment method selected

### Issue: Validation errors not clearing
**Solution**: This is expected behavior - errors clear when field is corrected

---

## Test Data Examples

### Valid Test Data
```
Taxpayer Name: Juan Dela Cruz
TIN: 123-456-789-000
Email: test@example.com
Amount: 1000.00
Branch: Main Branch
```

### Edge Cases
```
Minimum Amount: 0.01
Maximum Amount: 999999.99
Long Name: Very Long Taxpayer Name That Tests Character Limits
Special Characters in Name: José María Dela Cruz-Santos
```

---

## Reporting Issues

When reporting issues, include:
1. **Steps to reproduce**
2. **Expected behavior**
3. **Actual behavior**
4. **Screenshots** (if applicable)
5. **Browser/device** information
6. **Console errors** (if any)
7. **Network tab** information (for API issues)

---

## Success Criteria

A payment flow is considered successful when:
1. ✅ All required fields validated
2. ✅ Payment reference generated
3. ✅ PayMongo checkout session created
4. ✅ User redirected to checkout
5. ✅ Payment completed (or failed) in PayMongo
6. ✅ User redirected back to appropriate page
7. ✅ Status displayed correctly
8. ✅ Database record created/updated
9. ✅ Activity logs created
10. ✅ UI displays correctly on all devices

---

**Last Updated**: April 28, 2026
**Version**: 1.0
**Maintainer**: WARDS Development Team
