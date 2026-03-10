package com.palladium.backend;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.LongSupplier;

/**
 * Thread-safe sliding window rate limiter keyed by arbitrary string identifiers.
 *
 * <p>This limiter stores request timestamps per key and allows a request when the number of
 * requests in the configured time window is below the configured limit. It is designed for
 * lightweight in-memory abuse protection at the API edge.</p>
 */
final class SlidingWindowRateLimiter {
    private final ConcurrentMap<String, Deque<Long>> buckets;
    private final LongSupplier nowMillis;

    /**
     * Creates a limiter using {@link System#currentTimeMillis()} as the clock source.
     */
    SlidingWindowRateLimiter() {
        this(System::currentTimeMillis);
    }

    /**
     * Creates a limiter with an injected clock supplier.
     *
     * @param nowMillis supplier returning current epoch milliseconds
     */
    SlidingWindowRateLimiter(LongSupplier nowMillis) {
        this.buckets = new ConcurrentHashMap<>();
        this.nowMillis = Objects.requireNonNull(nowMillis, "nowMillis");
    }

    /**
     * Attempts to consume one token for the provided key.
     *
     * @param key unique limiter key, usually based on endpoint + client IP
     * @param maxRequests maximum allowed requests in the active time window
     * @param window time window for counting requests
     * @return {@code true} when request is allowed, {@code false} when throttled
     */
    boolean allow(String key, int maxRequests, Duration window) {
        if (maxRequests <= 0) {
            return false;
        }
        long windowMillis = Math.max(1L, window.toMillis());
        long now = nowMillis.getAsLong();
        long cutoff = now - windowMillis;

        Deque<Long> timestamps = buckets.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (timestamps) {
            while (!timestamps.isEmpty() && timestamps.peekFirst() <= cutoff) {
                timestamps.removeFirst();
            }
            if (timestamps.size() >= maxRequests) {
                return false;
            }
            timestamps.addLast(now);
            if (timestamps.isEmpty()) {
                buckets.remove(key, timestamps);
            }
            return true;
        }
    }
}
