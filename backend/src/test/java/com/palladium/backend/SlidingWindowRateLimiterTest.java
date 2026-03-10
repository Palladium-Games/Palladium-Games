package com.palladium.backend;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link SlidingWindowRateLimiter}.
 */
class SlidingWindowRateLimiterTest {

    @Test
    void allowsRequestsWithinConfiguredWindowLimit() {
        AtomicLong now = new AtomicLong(1_000L);
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(now::get);

        assertTrue(limiter.allow("proxy:1.1.1.1", 2, Duration.ofSeconds(60)));
        assertTrue(limiter.allow("proxy:1.1.1.1", 2, Duration.ofSeconds(60)));
        assertFalse(limiter.allow("proxy:1.1.1.1", 2, Duration.ofSeconds(60)));
    }

    @Test
    void expiresRequestsOutsideWindow() {
        AtomicLong now = new AtomicLong(1_000L);
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(now::get);

        assertTrue(limiter.allow("ai:2.2.2.2", 1, Duration.ofSeconds(10)));
        now.set(12_001L);
        assertTrue(limiter.allow("ai:2.2.2.2", 1, Duration.ofSeconds(10)));
    }

    @Test
    void tracksKeysIndependently() {
        AtomicLong now = new AtomicLong(5_000L);
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(now::get);

        assertTrue(limiter.allow("proxy:1.1.1.1", 1, Duration.ofSeconds(30)));
        assertFalse(limiter.allow("proxy:1.1.1.1", 1, Duration.ofSeconds(30)));
        assertTrue(limiter.allow("proxy:3.3.3.3", 1, Duration.ofSeconds(30)));
    }
}
