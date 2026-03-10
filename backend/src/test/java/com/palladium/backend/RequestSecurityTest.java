package com.palladium.backend;

import org.junit.jupiter.api.Test;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link RequestSecurity} proxy target hardening behavior.
 */
class RequestSecurityTest {

    @Test
    void blocksLocalhostAndPrivateTargetsWhenEnabled() {
        assertTrue(RequestSecurity.isBlockedProxyTarget(URI.create("http://localhost:3000"), true));
        assertTrue(RequestSecurity.isBlockedProxyTarget(URI.create("http://127.0.0.1"), true));
        assertTrue(RequestSecurity.isBlockedProxyTarget(URI.create("http://10.0.0.5"), true));
        assertTrue(RequestSecurity.isBlockedProxyTarget(URI.create("http://192.168.1.10"), true));
        assertTrue(RequestSecurity.isBlockedProxyTarget(URI.create("http://172.16.20.10"), true));
        assertTrue(RequestSecurity.isBlockedProxyTarget(URI.create("http://[::1]"), true));
    }

    @Test
    void allowsPublicTargetsWhenPrivateBlockingEnabled() {
        assertFalse(RequestSecurity.isBlockedProxyTarget(URI.create("https://example.com"), true));
        assertFalse(RequestSecurity.isBlockedProxyTarget(URI.create("https://duckduckgo.com"), true));
    }

    @Test
    void allowsAllTargetsWhenPrivateBlockingDisabled() {
        assertFalse(RequestSecurity.isBlockedProxyTarget(URI.create("http://127.0.0.1"), false));
        assertFalse(RequestSecurity.isBlockedProxyTarget(URI.create("http://localhost"), false));
    }
}
