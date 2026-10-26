import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPrivateOrBlockedIp, validateUrlForOutboundFetch } from './ssrf-guard';

describe('SSRF Guard: IP and URL Safety', () => {
  it('blocks private IPv4 networks and loopbacks', () => {
    // Loopback
    assert.equal(isPrivateOrBlockedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrBlockedIp('127.255.255.255'), true);

    // Private classes A, B, C
    assert.equal(isPrivateOrBlockedIp('10.0.0.1'), true);
    assert.equal(isPrivateOrBlockedIp('10.254.1.20'), true);
    assert.equal(isPrivateOrBlockedIp('172.16.0.1'), true);
    assert.equal(isPrivateOrBlockedIp('172.31.255.254'), true);
    assert.equal(isPrivateOrBlockedIp('192.168.1.1'), true);

    // Link-local & cloud metadata
    assert.equal(isPrivateOrBlockedIp('169.254.169.254'), true);
    assert.equal(isPrivateOrBlockedIp('169.254.1.1'), true);

    // Current network & CGNAT
    assert.equal(isPrivateOrBlockedIp('0.0.0.0'), true);
    assert.equal(isPrivateOrBlockedIp('100.64.0.1'), true);

    // Valid public IP
    assert.equal(isPrivateOrBlockedIp('8.8.8.8'), false);
    assert.equal(isPrivateOrBlockedIp('1.1.1.1'), false);
  });

  it('blocks private IPv6 networks and loopbacks', () => {
    assert.equal(isPrivateOrBlockedIp('::1'), true);
    assert.equal(isPrivateOrBlockedIp('::'), true);
    assert.equal(isPrivateOrBlockedIp('fc00::1'), true);
    assert.equal(isPrivateOrBlockedIp('fe80::1'), true);
    assert.equal(isPrivateOrBlockedIp('::ffff:127.0.0.1'), true);
  });

  it('rejects disallowed protocols in validateUrlForOutboundFetch', async () => {
    const fileRes = await validateUrlForOutboundFetch('file:///etc/passwd');
    assert.equal(fileRes.valid, false);
    assert.match(fileRes.reason!, /Disallowed protocol/);

    const ftpRes = await validateUrlForOutboundFetch('ftp://example.com/test');
    assert.equal(ftpRes.valid, false);

    const gopherRes = await validateUrlForOutboundFetch('gopher://example.com');
    assert.equal(gopherRes.valid, false);
  });

  it('rejects localhost hostnames', async () => {
    const res1 = await validateUrlForOutboundFetch('http://localhost:3000/api');
    assert.equal(res1.valid, false);

    const res2 = await validateUrlForOutboundFetch('http://foo.localhost/api');
    assert.equal(res2.valid, false);

    const res3 = await validateUrlForOutboundFetch('http://127.0.0.1:8080');
    assert.equal(res3.valid, false);

    const res4 = await validateUrlForOutboundFetch('http://169.254.169.254/latest/meta-data/');
    assert.equal(res4.valid, false);
  });
});
