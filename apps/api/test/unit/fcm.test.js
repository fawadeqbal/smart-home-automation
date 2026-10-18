// Phone push through Firebase (HTTP v1) without the SDK: the key, the signed JWT, the message, and what
// happens with Google's answers (the HTTP calls go to a fake).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createVerify } = require('node:crypto');
const { readServiceAccount, buildJwt, fcmMessage, tokenIsGone, FcmClient, FCM_SCOPE } = require('../../dist/monitoring/fcm.js');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { type: 'service_account', project_id: 'switchboard-test', client_email: 'push@switchboard-test.iam.gserviceaccount.com', private_key: KEY_PEM };

test('the key: JSON or base64 of it; nothing is fine; anything else says what is wrong', () => {
  assert.equal(readServiceAccount(''), null);
  assert.equal(readServiceAccount(undefined), null);
  assert.equal(readServiceAccount(JSON.stringify(SA)).project_id, 'switchboard-test');
  const b64 = Buffer.from(JSON.stringify(SA)).toString('base64');
  assert.equal(readServiceAccount(b64).client_email, SA.client_email);
  // a private key whose newlines became "\n" on the way (a .env line)
  const flat = JSON.stringify({ ...SA, private_key: KEY_PEM.replace(/\n/g, '\\n') });
  assert.equal(readServiceAccount(flat.replace(/\\\\n/g, '\\n')).private_key.includes('\n'), true);
  assert.throws(() => readServiceAccount('{"project_id":"x"}'), /missing project_id, client_email or private_key/);
  assert.throws(() => readServiceAccount('not a key'), /neither JSON nor base64/);
});

test('the JWT is RS256, for the messaging scope, an hour long, and verifies with the public key', () => {
  const jwt = buildJwt(SA, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual(claims, {
    iss: SA.client_email, scope: FCM_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600,
  });
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')), true);
});

test('a notice becomes one message: alerts loud and on the Alerts channel, the link as data', () => {
  const alert = fcmMessage('tok-1', { id: 'n1', title: 'Water leak in the Kitchen!', body: 'Check it now.', link: '/devices/d1?home=h1', severity: 'ALERT', kind: 'leak', homeId: 'h1' });
  assert.equal(alert.message.token, 'tok-1');
  assert.deepEqual(alert.message.notification, { title: 'Water leak in the Kitchen!', body: 'Check it now.' });
  assert.deepEqual(alert.message.data, { id: 'n1', severity: 'ALERT', link: '/devices/d1?home=h1', kind: 'leak', homeId: 'h1' });
  assert.equal(alert.message.android.priority, 'HIGH');
  assert.equal(alert.message.android.notification.channel_id, 'alerts');
  assert.equal(alert.message.apns.headers['apns-priority'], '10');
  const info = fcmMessage('tok-1', { id: 'n2', title: 'Away mode is on', body: 'x', link: null, severity: 'INFO' });
  assert.equal(info.message.android.priority, 'NORMAL');
  assert.equal(info.message.android.notification.channel_id, 'general');
  assert.equal(info.message.data.link, undefined);
  // every data value is a string (FCM refuses anything else)
  for (const v of Object.values(alert.message.data)) assert.equal(typeof v, 'string');
});

test('which answers mean the phone is gone', () => {
  assert.equal(tokenIsGone(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), true);
  assert.equal(tokenIsGone(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }), true);
  assert.equal(tokenIsGone(400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.android.ttl' } }), false);
  assert.equal(tokenIsGone(500, null), false);
  assert.equal(tokenIsGone(429, { error: { status: 'RESOURCE_EXHAUSTED' } }), false);
});

test('the client: one access token, reused until near its end; a gone token is reported', async () => {
  const calls = [];
  let now = 1_800_000_000_000;
  const answers = { 'tok-ok': 200, 'tok-gone': 404, 'tok-bad': 500 };
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.match(init.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=ey/);
      return { status: 200, json: async () => ({ access_token: `at-${calls.length}`, expires_in: 3599 }) };
    }
    const msg = JSON.parse(init.body).message;
    const status = answers[msg.token];
    return { status, json: async () => (status === 404 ? { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } : status === 500 ? { error: { message: 'busy' } } : { name: 'x' }) };
  };
  const client = new FcmClient(readServiceAccount(JSON.stringify(SA)), fake, () => now);
  const n = { id: 'n1', title: 't', body: 'b', severity: 'WARN' };
  assert.deepEqual(await client.send('tok-ok', n), { result: 'sent', status: 200 });
  assert.equal((await client.send('tok-gone', n)).result, 'gone');
  const failed = await client.send('tok-bad', n);
  assert.equal(failed.result, 'failed');
  assert.equal(failed.error, 'busy');
  const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
  assert.equal(tokenCalls.length, 1); // cached
  const send = calls.find((c) => c.url.includes('fcm.googleapis.com'));
  assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/switchboard-test/messages:send');
  assert.equal(send.init.headers.Authorization, 'Bearer at-1');
  now += 3600_000; // an hour later: a new token
  await client.send('tok-ok', n);
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 2);
});

test('a refused key says so (and nothing is sent)', async () => {
  const fake = async (url) => (url.includes('oauth2')
    ? { status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) }
    : assert.fail('must not send'));
  const client = new FcmClient(readServiceAccount(JSON.stringify(SA)), fake);
  await assert.rejects(client.send('tok', { id: 'n', title: 't', body: 'b', severity: 'INFO' }), /Google refused the Firebase key \(400: Invalid JWT Signature\.\)/);
});
