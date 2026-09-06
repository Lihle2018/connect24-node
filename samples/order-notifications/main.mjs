/**
 * Runs the notifier for one demo order. Safe to run with a TEST key: the recipients below
 * use the simulation local parts (`queued@`, `bounced@`), which never leave the platform
 * and cost nothing — the whole flow works, including the suppression path.
 *
 *   set CONNECT24_ACCOUNT_ID=acc_...
 *   set CONNECT24_API_KEY=ck_test_...
 *   npm start
 */
import { Connect24 } from '@connect24/sdk';
import { OrderNotifier, OutOfCreditError } from './orderNotifier.mjs';

const client = Connect24.fromEnv ? Connect24.fromEnv() : new Connect24({
  accountId: process.env.CONNECT24_ACCOUNT_ID,
  apiKey: process.env.CONNECT24_API_KEY,
});

const notifier = new OrderNotifier(client);

try {
  const result = await notifier.notifyShipped({
    id: '1042',
    customerName: 'Thandi',
    email: process.env.CONNECT24_EMAIL_TO ?? 'queued@example.com',
    phone: process.env.CONNECT24_SMS_TO,
    trackingUrl: 'https://store.example/track/1042',
  });
  console.log('email:', result.email);
  console.log('sms:  ', result.sms);
} catch (error) {
  if (error instanceof OutOfCreditError) {
    console.error('Top up before retrying:', error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
